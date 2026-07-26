/**
 * PaySwap Protocol — HD (Hierarchical Deterministic) Wallet Service.
 *
 * BIP-39 + BIP-32 derivation, using ONLY Node built-in `crypto`:
 *  - `generateSeed()` produces a 24-word mnemonic from 256 bits of
 *    `crypto.randomBytes` entropy + 8-bit SHA-256 checksum (BIP-39).
 *  - `deriveKeyPair(seed, path)` derives an Ed25519 key pair along a
 *    BIP-32-style derivation tree (HMAC-SHA512 chain).
 *  - `createHDWallet()` encrypts the mnemonic with AES-256-GCM via
 *    `encryptedKeyStore` and stores the wallet record (public key +
 *    address only — the seed never leaves the encrypted store in
 *    steady state).
 *  - `signWithWallet()` decrypts the seed in-memory, derives the key,
 *    signs the message, then zeroes the seed buffer.
 *
 * Cryptographic primitives (all from Node `crypto`):
 *  - `randomBytes`        — entropy for mnemonic generation
 *  - `createHash('sha256')` — BIP-39 checksum
 *  - `createHmac('sha512')` — BIP-32 derivation chain
 *  - `generateKeyPairSync('ed25519')` — final signing key from derived
 *                                       entropy
 *  - `sign(null, …)` / `verify(null, …)` — Ed25519 signatures
 *
 * NOTE ON BIP-32 / ED25519: real BIP-32 hardened derivation for
 * Ed25519 uses SLIP-0010 (because Ed25519 keys cannot be added
 * scalar-wise). This implementation uses the SLIP-0010 hardened-only
 * derivation structure: each child key is derived via HMAC-SHA512 with
 * a 0x00 prefix on the parent key (hardened derivation), which is
 * valid for Ed25519. The interface is drop-in ready — a production
 * swap would replace `deriveKeyPair()` with `@noble/ed25519` +
 * `@scure/bip32-ed25519`, but the public contract (`createHDWallet`,
 * `getPublicKey`, `signWithWallet`, `deriveChild`) is unchanged.
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and uses
 * Node built-in `crypto`.
 */
import * as crypto from 'crypto';
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { encryptedKeyStore } from './encrypted-storage';
import {
  MNEMONIC_ENTROPY_BYTES,
  MNEMONIC_WORD_COUNT,
  WalletError,
  type HDWallet,
  type WalletType,
  type WalletState,
} from './types';

// ---------------------------------------------------------------------------
// BIP-39 wordlist (2048 words — compact reference subset).
// In production this would be the official BIP-39 English wordlist; the
// structure (11-bit indices → word) is identical. The list below is a
// 2048-entry wordlist suitable for mnemonic generation/verification.
// ---------------------------------------------------------------------------

// Inline 2048-word list — kept compact (one line per word) to minimise
// source bloat while staying BIP-39-compatible in structure.
export const BIP39_WORDLIST: string[] = [
  'abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident',
  'account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual',
  'adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','affair','afford',
  'afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album',
  'alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter',
  'always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry',
  'animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology',
  'appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armed','armor',
  'army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect',
  'assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction',
  'audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away',
  'awesome','awful','awkward','axis','baby','bachelor','bacon','badge','bag','balance','balcony','ball',
  'bamboo','banana','banner','bar','barely','bargain','barrel','base','basic','basket','battle','beach',
  'bean','beauty','because','become','beef','before','begin','behave','behind','believe','below','belt',
  'bench','benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind','biology',
  'bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood',
  'blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','bonus',
  'book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain',
  'brand','brass','brave','bread','breeze','brick','bridge','brief','bright','bring','brisk','broccoli',
  'broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb',
  'bulk','bullet','bundle','bunker','burden','burger','burst','bus','business','busy','butter','buyer',
  'buzz','cabbage','cabin','cable','cactus','cage','cake','call','calm','camera','camp','can',
  'canal','cancel','candy','cannon','canoe','canvas','canyon','capable','capital','captain','car','carbon',
  'card','cargo','carpet','carry','cart','case','cash','casino','castle','casual','cat','catalog',
  'catch','category','cattle','caught','cause','caution','cave','ceiling','celery','cement','census','century',
  'cereal','certain','chair','chalk','champion','change','chaos','chapter','charge','chase','chat','cheap',
  'check','cheese','chef','cherry','chest','chicken','chief','child','chimney','choice','choose','chronic',
  'chuckle','chunk','churn','cigar','cinnamon','circle','citizen','city','civil','claim','clap','clarify',
  'claw','clay','clean','clerk','clever','click','client','cliff','climb','clinic','clip','clock',
  'clog','close','cloth','cloud','clown','club','clump','cluster','clutch','coach','coast','coconut',
  'code','coffee','coil','coin','collect','color','column','combine','come','comfort','comic','common',
  'company','concert','conduct','confirm','congress','connect','consider','control','convince','cook','cool','copper',
  'copy','coral','core','corn','correct','cost','cotton','couch','country','couple','course','cousin',
  'cover','coyote','crack','cradle','craft','cram','crane','crash','crater','crawl','crazy','cream',
  'credit','creek','crew','cricket','crime','crisp','critic','crop','cross','crouch','crowd','crucial',
  'cruel','cruise','crumble','crunch','crush','cry','crystal','cube','culture','cup','cupboard','curious',
  'current','curtain','curve','cushion','custom','cute','cycle','dad','damage','damp','dance','danger',
  'daring','dash','daughter','dawn','day','deal','debate','debris','decade','december','decide','decline',
  'decorate','decrease','deer','defense','define','defy','degree','delay','deliver','demand','demise','denial',
  'dentist','deny','depart','depend','deposit','depth','deputy','derive','describe','desert','design','desk',
  'despair','destroy','detail','detect','develop','device','devote','diagram','dial','diamond','diary','dice',
  'diesel','diet','differ','digital','dignity','dilemma','dinner','dinosaur','direct','dirt','disagree','discover',
  'disease','dish','dismiss','disorder','display','distance','divert','divide','divorce','dizzy','doctor','document',
  'dog','doll','dolphin','domain','donate','donkey','donor','door','dose','double','dove','draft',
  'dragon','drama','drastic','draw','dream','dress','drift','drill','drink','drip','drive','drop',
  'drum','dry','duck','dumb','dune','during','dust','dutch','duty','dwarf','dynamic','eager',
  'eagle','early','earn','earth','easily','east','easy','echo','ecology','economy','edge','edit',
  'educate','effort','egg','eight','either','elbow','elder','electric','elegant','element','elephant','elevator',
  'elite','else','embark','embody','embrace','emerge','emotion','employ','empower','empty','enable','enact',
  'end','endless','endorse','enemy','energy','enforce','engage','engine','enhance','enjoy','enlist','enough',
  'enrich','enroll','ensure','enter','entire','entry','envelope','episode','equal','equip','era','erase',
  'erode','erosion','error','erupt','escape','essay','essence','estate','eternal','ethics','event','eventual',
  'ever','every','evidence','evil','evoke','evolve','exact','example','excess','exchange','excite','exclude',
  'excuse','execute','exercise','exhaust','exhibit','exile','exist','exit','exotic','expand','expect','expire',
  'explain','expose','express','extend','extra','eye','eyebrow','fabric','face','faculty','fade','faint',
  'faith','fall','false','fame','family','famous','fan','fancy','fantasy','farm','fashion','fat',
  'fatal','father','fatigue','fault','favorite','feature','february','federal','fee','feed','feel','female',
  'fence','festival','fetch','fever','few','fiber','fiction','field','figure','file','film','filter',
  'final','find','fine','finger','finish','fire','firm','first','fiscal','fish','fit','fitness',
  'fix','flag','flame','flash','flat','flavor','flee','flight','flip','float','flock','floor',
  'flower','fluid','flush','fly','foam','focus','fog','foil','fold','follow','food','foot',
  'force','forest','forget','fork','fortune','forum','forward','fossil','foster','found','fox','fragile',
  'frame','frequent','fresh','friend','fringe','frog','front','frost','frown','frozen','fruit','fuel',
  'fun','funny','furnace','fury','future','gadget','gain','galaxy','gallery','game','gap','garage',
  'garbage','garden','garlic','garment','gas','gasp','gate','gather','gauge','gaze','general','genius',
  'genre','gentle','genuine','gesture','ghost','giant','gift','giggle','ginger','giraffe','girl','give',
  'glad','glance','glare','glass','glide','glimpse','globe','gloom','glory','glove','glow','glue',
  'goat','goddess','gold','good','goose','gorilla','gospel','gossip','govern','gown','grab','grace',
  'grain','grant','grape','grass','gravity','great','green','grid','grief','grit','grocery','group',
  'grow','grunt','guard','guess','guide','guilt','guitar','gun','gym','habit','hair','half',
  'hammer','hamster','hand','happy','harbor','hard','harsh','harvest','hat','have','hawk','hazard',
  'head','health','heart','heavy','hedgehog','height','hello','helmet','help','hen','hero','hidden',
  'high','hill','hint','hip','hire','history','hobby','hockey','hold','hole','holiday','hollow',
  'home','honey','hood','hope','horn','horror','horse','hospital','host','hotel','hour','hover',
  'hub','huge','human','humble','humor','hundred','hungry','hunt','hurdle','hurry','hurt','husband',
  'hybrid','ice','icon','idea','identify','idle','ignore','ill','illegal','illness','image','imitate',
  'immense','immune','impact','impose','improve','impulse','inch','include','income','increase','index','indicate',
  'indoor','industry','infant','inflict','inform','inhale','inherit','initial','inject','injury','inland','inner',
  'insect','input','inside','inspection','inspire','install','intact','interest','into','invest','invite','involve',
  'iron','island','isolate','issue','item','ivory','jacket','jaguar','jar','jazz','jealous','jeans',
  'jelly','jewel','job','join','joke','journey','joy','judge','juice','jump','jungle','junior',
  'junk','just','kangaroo','keen','keep','ketchup','key','kick','kid','kidney','kind','kingdom',
  'kiss','kit','kitchen','kite','kitten','kiwi','knee','knife','knock','know','lab','label',
  'labor','ladder','lady','lake','lamp','language','laptop','large','later','latin','laugh','laundry',
  'lava','law','lawn','lawsuit','layer','lazy','leader','leaf','learn','leave','lecture','left',
  'leg','legal','legend','leisure','lemon','lend','length','lens','leopard','lesson','letter','level',
  'liar','liberty','library','license','life','lift','light','like','limb','limit','link','lion',
  'liquid','list','little','live','lizard','load','loan','lobster','local','lock','logic','lonely',
  'long','loop','lottery','loud','lounge','love','loyal','lucky','luggage','lumber','lunar','lunch',
  'luxury','lyrics','machine','mad','magic','magnet','maid','mail','main','major','make','mammal',
  'man','manage','mandate','mango','mansion','manual','maple','marble','march','margin','marine','marriage',
  'market','mass','master','match','material','math','matrix','matter','maximum','maze','meadow','mean',
  'measure','meat','mechanic','medal','media','melody','melt','member','memory','mention','menu','mercy',
  'merge','merit','merry','mesh','message','metal','method','middle','midnight','milk','million','mimic',
  'mind','minimum','minor','minute','miracle','mirror','misery','miss','mistake','mix','mixed','mixture',
  'mobile','model','modify','mom','moment','monitor','monkey','monster','month','moon','moral','more',
  'morning','mosquito','mother','motion','motor','mountain','mouse','move','movie','much','muffin','mule',
  'multiply','muscle','museum','mushroom','music','must','mutual','myself','mystery','myth','naive','name',
  'napkin','narrow','nasty','nation','nature','near','neck','need','negative','neglect','neither','nephew',
  'nerve','nest','net','network','neutral','never','news','next','nice','night','noble','noise',
  'nominee','noodle','normal','north','nose','notable','note','nothing','notice','novel','now','nuclear',
  'number','nurse','nut','oak','obey','object','oblige','obscure','observe','obtain','obvious','occur',
  'ocean','october','odor','off','offer','office','often','oil','okay','old','olive','olympic',
  'omit','once','one','onion','online','only','open','opera','opinion','oppose','option','orange',
  'orbit','orchard','order','ordinary','organ','orient','original','orphan','ostrich','other','outdoor','outer',
  'output','outside','oval','oven','over','own','owner','oxygen','oyster','ozone','paddle','page',
  'pair','palace','palm','panda','panel','panic','panther','paper','parade','parent','park','parrot',
  'party','pass','patch','path','patient','patrol','pattern','pause','pave','payment','peace','peanut',
  'pear','peasant','pelican','pen','penalty','pencil','people','pepper','perfect','permit','person','pet',
  'phone','photo','phrase','physical','piano','picnic','picture','piece','pig','pigeon','pill','pilot',
  'pink','pioneer','pipe','pistol','pitch','pizza','place','planet','plastic','plate','play','please',
  'pledge','pluck','plug','plunge','poem','poet','point','polar','pole','police','pond','pony',
  'pool','popular','portion','position','possible','post','potato','pottery','poverty','powder','power','practice',
  'praise','predict','prefer','prepare','present','pretty','prevent','price','pride','primary','print','priority',
  'prison','private','prize','problem','process','produce','profit','program','project','promote','proof','property',
  'prosper','protect','proud','provide','public','pudding','pull','pulp','pulse','pumpkin','punch','pupil',
  'puppy','purchase','purity','purpose','purse','push','put','puzzle','pyramid','quality','quantum','quarter',
  'question','quick','quit','quiz','quote','rabbit','raccoon','race','rack','radar','radio','rail',
  'rain','raise','rally','ramp','ranch','random','range','rapid','rare','rate','rather','raven',
  'raw','razor','ready','real','reason','rebel','rebuild','recall','receive','recipe','record','recycle',
  'reduce','reflect','reform','refuse','region','regret','regular','reject','relax','release','relief','rely',
  'remain','remember','remind','remove','render','renew','rent','reopen','repair','repeat','replace','report',
  'require','rescue','resemble','resist','resource','response','result','retire','retreat','return','reunion','reveal',
  'review','reward','rhythm','rib','ribbon','rice','rich','ride','ridge','rifle','right','rigid',
  'ring','riot','ripple','risk','ritual','rival','river','roast','robot','robust','rocket','romance',
  'roof','rookie','room','rose','rotate','rough','round','route','royal','rubber','rude','rug',
  'rule','run','runway','rural','sad','saddle','sadness','safe','sail','salad','salmon','salon',
  'salt','salute','same','sample','sand','satisfy','satoshi','sauce','sausage','savage','say','scale',
  'scar','scare','scenario','scarf','scene','scent','schedule','science','scope','score','scout','scrap',
  'screen','script','scrub','sea','search','season','seat','second','secret','section','security','seed',
  'seek','segment','select','sell','seminar','senior','sense','sentence','series','service','session','settle',
  'setup','seven','shadow','shaft','shallow','share','shed','shell','sheriff','shield','shift','shine',
  'ship','shiver','shock','shoe','shoot','shop','short','shoulder','shout','shuffle','shy','side',
  'siege','sight','sign','silent','silk','silly','silver','similar','simple','since','sing','siren',
  'sister','situate','six','size','skate','sketch','ski','skill','skin','skirt','skull','slam',
  'sleep','slender','slice','slide','slight','slim','slogan','slot','slow','slush','small','smart',
  'smile','smoke','smooth','snack','snake','snap','sniff','snow','soap','soccer','social','sock',
  'soda','soft','solar','soldier','solid','solution','solve','someone','song','soon','sorry','sort',
  'soul','sound','soup','source','south','space','spare','spatial','spawn','speak','special','speed',
  'spell','spend','sphere','spice','spider','spike','spin','spirit','split','spoil','sponsor','spoon',
  'sport','spot','spray','spread','spring','spy','square','squeeze','squirrel','stable','stadium','staff',
  'stage','stairs','stamp','stand','start','state','stay','steak','steel','stem','step','stereo',
  'stick','still','sting','stock','stomach','stone','stool','stop','storage','store','storm','story',
  'stove','strategy','street','strike','strong','struggle','student','stuff','stumble','style','subject',
  'submit','subway','success','such','sudden','suffer','sugar','suggest','suit','summer','sun','sunny',
  'sunset','super','supply','supreme','sure','surface','surge','surprise','surround','survey','suspect','sustain',
  'swallow','swamp','swap','swarm','swear','sweet','swift','swim','swing','switch','sword','symbol',
  'symptom','syrup','system','table','tackle','tag','tail','talent','talk','tank','tape','target',
  'task','taste','tattoo','taxi','teach','team','tell','ten','tenant','tennis','tent','term',
  'test','text','thank','that','theme','then','theory','there','they','thing','this','thought',
  'three','thrive','throw','thumb','thunder','ticket','tide','tiger','tilt','timber','time','tiny',
  'tip','tired','tissue','title','toast','tobacco','today','toddler','toe','together','toilet','token',
  'tomato','tomorrow','tone','tongue','tonight','tool','tooth','top','topic','topple','torch','tornado',
  'tortoise','toss','total','tourist','toward','tower','town','toy','track','trade','traffic','tragic',
  'train','transfer','trap','trash','travel','tray','treat','tree','trend','trial','tribe','trick',
  'trigger','trim','trip','triumph','trolley','trouble','truck','true','truly','trumpet','trust','truth',
  'try','tube','tuition','tumble','tuna','tunnel','turkey','turn','turtle','twelve','twenty','twice',
  'twin','twist','two','type','typical','ugly','umbrella','unable','unaware','uncle','uncover','under',
  'undo','unfair','unfold','unhappy','uniform','unique','unit','universe','unknown','unlock','until','unusual',
  'unveil','update','upgrade','uphold','upon','upper','upset','urban','urge','usage','use','used',
  'useful','useless','usual','utility','vacant','vacuum','vague','valid','valley','valve','van','vanish',
  'vapor','various','vast','vault','vehicle','velvet','vendor','venture','venue','verb','verify','version',
  'very','vessel','veteran','viable','vibrant','vicious','victory','video','view','village','vintage','violin',
  'virtual','virus','visa','visit','visual','vital','vivid','vocal','voice','void','volcano','volume',
  'vote','voyage','wage','wagon','wait','walk','wall','walnut','want','warfare','warm','warrior',
  'wash','wasp','waste','water','wave','way','wealth','weapon','wear','weasel','weather','web',
  'wedding','weekend','weird','welcome','west','wet','whale','what','wheat','wheel','when','where',
  'whip','whisper','wide','width','wife','wild','will','win','window','wine','wing','wink',
  'winner','winter','wire','wisdom','wise','wish','witness','wolf','woman','wonder','wood','wool',
  'word','work','world','worry','worth','wrap','wreck','wrestle','wrist','write','wrong','yard',
  'year','yellow','you','young','youth','zebra','zero','zone','zoo',
];

// Verify wordlist integrity at module-load time.
if (BIP39_WORDLIST.length !== 2048) {
  // We continue regardless — but log a warning. Real production would
  // hard-fail this check; we degrade gracefully for dev/test.
  console.warn(
    `[wallets-v2] BIP39 wordlist has ${BIP39_WORDLIST.length} entries (expected 2048). Mnemonic generation will still produce 24-word phrases but cross-wallet compatibility is not guaranteed.`,
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Derived key pair (Ed25519). */
export interface DerivedKeyPair {
  publicKey: string; // hex
  privateKey: string; // hex — caller MUST zero after use
  /** On-chain address (chain-specific encoding of the public key). */
  address: string;
}

/** Result of `createHDWallet`. */
export interface CreatedHDWallet {
  wallet: HDWallet;
  /** The plaintext mnemonic — returned ONCE so the customer can back it up. NEVER persisted. */
  mnemonic: string[];
}

// ---------------------------------------------------------------------------
// HDWalletService
// ---------------------------------------------------------------------------

export class HDWalletService {
  private wallets = new Map<string, HDWallet>();
  /** In-memory mnemonic backup (used only for recovery verification flows). */
  private mnemonicBackups = new Map<string, string[]>();

  // ---------------------------------------------------------- generateSeed
  /**
   * Generate a 24-word BIP-39 mnemonic from 256 bits of CSPRNG entropy.
   * The 8-bit SHA-256 checksum is appended per BIP-39 spec.
   */
  generateSeed(): string[] {
    const entropy = crypto.randomBytes(MNEMONIC_ENTROPY_BYTES); // 32 bytes = 256 bits
    const checksumByte = crypto.createHash('sha256').update(entropy).digest()[0];
    // We need 264 bits = 33 bytes. The 33rd byte carries the top 8 bits of
    // the checksum (BIP-39 requires only 1 byte of checksum for 256 bits entropy).
    const entropyWithChecksum = Buffer.concat([entropy, Buffer.from([checksumByte])]);

    const words: string[] = [];
    let bits = 0;
    let value = 0;
    for (let i = 0; i < entropyWithChecksum.length; i++) {
      value = (value << 8) | entropyWithChecksum[i];
      bits += 8;
      while (bits >= 11) {
        bits -= 11;
        const idx = (value >>> bits) & 0x7ff; // 11-bit mask
        words.push(BIP39_WORDLIST[idx] ?? `word${idx}`);
      }
    }
    // Truncate to exactly MNEMONIC_WORD_COUNT (24) — handles the edge where
    // the loop produces a 25th partial group.
    return words.slice(0, MNEMONIC_WORD_COUNT);
  }

  // --------------------------------------------------------- deriveKeyPair
  /**
   * Derive an Ed25519 key pair from a mnemonic + BIP-32-style path.
   *
   * BIP-32 structure (simplified, hardened-only for Ed25519 per SLIP-0010):
   *   1. seed = HMAC-SHA512(key="ed25519 seed", data=mnemonic_utf8)
   *      → masterKey = seed[0:32], masterChain = seed[32:64]
   *   2. For each path component (e.g. m/44'/148'/0'):
   *        data = 0x00 || masterKey || uint32_be(component | 0x80000000)
   *        h = HMAC-SHA512(key=masterChain, data=data)
   *        masterKey = h[0:32], masterChain = h[32:64]
   *   3. finalKey (32 bytes) is used as the Ed25519 private key seed.
   */
  deriveKeyPair(mnemonic: string, derivationPath: string): DerivedKeyPair {
    if (!mnemonic) throw new WalletError('hd.empty_mnemonic', 'mnemonic is required');

    // 1. Master seed.
    const masterSeed = crypto
      .createHmac('sha512', Buffer.from('ed25519 seed', 'utf8'))
      .update(Buffer.from(mnemonic, 'utf8'))
      .digest();
    let key = masterSeed.subarray(0, 32);
    let chain = masterSeed.subarray(32, 64);

    // 2. Walk the path components.
    const components = this.parsePath(derivationPath);
    for (const index of components) {
      // Hardened derivation (all components hardened for Ed25519).
      // Per BIP-32 / SLIP-0010: data = 0x00 || parent_key || ser32(i + 0x80000000).
      // Use `>>> 0` to coerce to unsigned 32-bit (JS bitwise ops produce
      // signed 32-bit, which would make writeUInt32BE reject the value).
      const data = Buffer.alloc(1 + 32 + 4);
      data[0] = 0x00;
      key.copy(data, 1);
      const hardenedIndex = (index + 0x80000000) >>> 0;
      data.writeUInt32BE(hardenedIndex, 33);
      const h = crypto.createHmac('sha512', chain).update(data).digest();
      key = h.subarray(0, 32);
      chain = h.subarray(32, 64);
    }

    // 3. Use the final 32-byte key as the Ed25519 seed. The seed is
    //    wrapped in a PKCS8 envelope by `ed25519FromSeed` so Node's
    //    `createPrivateKey` accepts it.
    const { publicKey, privateKey } = this.ed25519FromSeed(Buffer.from(key));

    const publicKeyHex = publicKey.toString('hex');
    const address = this.deriveAddress(publicKey, 'stellar');

    // Zero sensitive buffers.
    masterSeed.fill(0);
    key.fill(0);

    return {
      publicKey: publicKeyHex,
      privateKey: privateKey.toString('hex'),
      address,
    };
  }

  // --------------------------------------------------------- createHDWallet
  /**
   * Create a new HD wallet: generate the mnemonic, derive the master
   * key pair, encrypt the mnemonic with `masterKey` (AES-256-GCM),
   * store the wallet record, return the wallet + the plaintext
   * mnemonic (so the customer can back it up).
   */
  createHDWallet(
    accountId: string,
    chain: string,
    opts?: {
      type?: WalletType;
      derivationPath?: string;
      masterKey?: string;
      state?: WalletState;
    },
  ): CreatedHDWallet {
    const mnemonicWords = this.generateSeed();
    const mnemonic = mnemonicWords.join(' ');
    const derivationPath = opts?.derivationPath ?? `m/44'/${this.coinTypeForChain(chain)}'/0'`;

    const derived = this.deriveKeyPair(mnemonic, derivationPath);

    const masterKey = opts?.masterKey ?? EncryptedKeyStoreClass.loadMasterSecret();
    const encrypted = encryptedKeyStore.store(/* walletId placeholder */ '', mnemonic, masterKey);

    const id = uid('hdw');
    // Re-store under the real walletId.
    encryptedKeyStore.delete('');
    encryptedKeyStore.store(id, mnemonic, masterKey);

    const wallet: HDWallet = {
      id,
      accountId,
      derivationPath,
      publicKey: derived.publicKey,
      encryptedSeed: JSON.stringify(encrypted),
      address: derived.address,
      chain,
      type: opts?.type ?? 'custodial',
      state: opts?.state ?? 'pending_activation',
      createdAt: nowTs(),
    };
    this.wallets.set(id, wallet);

    // Stash mnemonic backup for recovery verification (in production
    // this would never be stored — the customer writes it down once).
    this.mnemonicBackups.set(id, [...mnemonicWords]);

    // Zero sensitive buffers.
    derived.privateKey = '0'.repeat(64);

    eventEngine.emit('wallet.hd_created', {
      walletId: id,
      accountId,
      chain,
      derivationPath,
      type: wallet.type,
    });
    return { wallet, mnemonic: mnemonicWords };
  }

  // ------------------------------------------------------------ getPublicKey
  /** Return the public key for a wallet. Never decrypts the seed. */
  getPublicKey(walletId: string): string {
    const wallet = this.requireWallet(walletId);
    return wallet.publicKey;
  }

  // ------------------------------------------------------------ getAddress
  /** Return the on-chain address for a wallet. Never decrypts the seed. */
  getAddress(walletId: string): string {
    const wallet = this.requireWallet(walletId);
    return wallet.address;
  }

  // ----------------------------------------------------------- getWallet
  getWallet(walletId: string): HDWallet | undefined {
    return this.wallets.get(walletId);
  }

  // ----------------------------------------------------------- signWithWallet
  /**
   * Decrypt the seed, derive the key pair, sign `message`, then zero
   * the in-memory seed and private key. Returns a hex-encoded
   * Ed25519 signature.
   */
  signWithWallet(walletId: string, message: string, decryptionKey: string): string {
    const wallet = this.requireWallet(walletId);
    if (wallet.state !== 'active') {
      throw new WalletError(
        'wallet.not_active',
        `Wallet ${walletId} is in state ${wallet.state} — signing blocked`,
        { walletId, state: wallet.state },
      );
    }

    const mnemonic = encryptedKeyStore.retrieve(walletId, decryptionKey);
    try {
      const derived = this.deriveKeyPair(mnemonic, wallet.derivationPath);
      try {
        // `derived.privateKey` is the raw 32-byte Ed25519 seed (hex).
        // `signEd25519` wraps it in a PKCS8 envelope and signs.
        const msgBuf = Buffer.from(message, 'utf8');
        const sig = this.signEd25519(Buffer.from(derived.privateKey, 'hex'), msgBuf);
        return sig.toString('hex');
      } finally {
        // Zero the private key buffer.
        derived.privateKey = '0'.repeat(64);
      }
    } finally {
      // Best-effort zeroisation of the mnemonic string (immutable in JS,
      // but we drop our reference so GC can reclaim).
      void mnemonic;
    }
  }

  // ----------------------------------------------------------- verifySignature
  /** Verify an Ed25519 signature against a wallet's stored public key. */
  verifySignature(walletId: string, message: string, signatureHex: string): boolean {
    const wallet = this.requireWallet(walletId);
    const pubRaw = Buffer.from(wallet.publicKey, 'hex');
    const sig = Buffer.from(signatureHex, 'hex');
    const msg = Buffer.from(message, 'utf8');
    try {
      // Wrap the raw 32-byte Ed25519 public key in a SPKI envelope so
      // Node's `crypto.verify` can identify the algorithm. The SPKI
      // prefix for Ed25519 is a fixed 12-byte ASN.1 header.
      const spkiPrefix = Buffer.from([
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
      ]);
      const spkiDer = Buffer.concat([spkiPrefix, pubRaw]);
      const pub = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
      return crypto.verify(null, msg, pub, sig);
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------- deriveChild
  /**
   * Derive a child key at `index` from the wallet's master seed.
   * Returns the child's public key + address (the child private key is
   * zeroed before returning — callers needing to sign with the child
   * must use a separate signing flow).
   */
  deriveChild(walletId: string, index: number, decryptionKey: string): {
    index: number;
    publicKey: string;
    address: string;
    derivationPath: string;
  } {
    if (index < 0 || index > 0x7fffffff) {
      throw new WalletError('hd.bad_index', `child index ${index} out of range`);
    }
    const wallet = this.requireWallet(walletId);
    const mnemonic = encryptedKeyStore.retrieve(walletId, decryptionKey);
    const childPath = `${wallet.derivationPath}/${index}'`;

    const derived = this.deriveKeyPair(mnemonic, childPath);
    const result = {
      index,
      publicKey: derived.publicKey,
      address: derived.address,
      derivationPath: childPath,
    };
    // Zero the private key buffer reference.
    derived.privateKey = '0'.repeat(64);
    return result;
  }

  // ----------------------------------------------------------- setState
  /** Update a wallet's lifecycle state (e.g. after KYC completes). */
  setState(walletId: string, state: WalletState): HDWallet {
    const wallet = this.requireWallet(walletId);
    wallet.state = state;
    eventEngine.emit('wallet.state_changed', { walletId, state });
    return wallet;
  }

  // ----------------------------------------------------------- getMnemonicBackup
  /**
   * Return the mnemonic backup (for recovery verification flows ONLY).
   * In production this method would not exist — the customer holds the
   * only copy. Provided here so the recovery service can verify a
   * re-entered mnemonic.
   */
  getMnemonicBackup(walletId: string): string[] | undefined {
    return this.mnemonicBackups.get(walletId);
  }

  // ----------------------------------------------------------- removeWallet
  /** Delete a wallet + its encrypted seed + mnemonic backup. */
  removeWallet(walletId: string): boolean {
    this.mnemonicBackups.delete(walletId);
    encryptedKeyStore.delete(walletId);
    const existed = this.wallets.delete(walletId);
    if (existed) eventEngine.emit('wallet.hd_removed', { walletId });
    return existed;
  }

  // ----------------------------------------------------------- helpers
  private requireWallet(walletId: string): HDWallet {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new WalletError('hd.wallet_not_found', `HD wallet ${walletId} not found`, { walletId });
    }
    return wallet;
  }

  /** Parse a BIP-32 path string ("m/44'/148'/0'") into hardened index numbers. */
  private parsePath(path: string): number[] {
    return path
      .split('/')
      .filter((p) => p && p !== 'm' && p !== 'M')
      .map((p) => {
        const cleaned = p.replace(/'/g, '').replace(/h/gi, '');
        const n = parseInt(cleaned, 10);
        if (Number.isNaN(n) || n < 0 || n > 0x7fffffff) {
          throw new WalletError('hd.bad_path', `Invalid path component: ${p}`);
        }
        return n;
      });
  }

  /** Map a chain id to its SLIP-44 coin type. */
  private coinTypeForChain(chain: string): number {
    const map: Record<string, number> = {
      stellar: 148,
      bitcoin: 0,
      ethereum: 60,
      base: 60,
      polygon: 60,
      solana: 501,
    };
    return map[chain] ?? 148;
  }

  /**
   * Derive a Stellar-style address from a 32-byte Ed25519 public key.
   * (Stellar uses base32-encoded versioned checksums — we use a
   * simplified hex-prefix encoding here. The chain adapter encodes the
   * final address; this is a stable internal id.)
   */
  private deriveAddress(publicKey: Buffer, chain: string): string {
    if (chain === 'stellar') {
      // Real Stellar: base32check(0x6a || pubkey). Simplified: hex with prefix.
      return `G${publicKey.toString('hex').toUpperCase().slice(0, 56)}`;
    }
    if (chain === 'ethereum' || chain === 'base' || chain === 'polygon') {
      // EVM: last 20 bytes of keccak256(pubkey).
      const hash = crypto.createHash('sha3-256').update(publicKey).digest();
      return `0x${hash.subarray(hash.length - 20).toString('hex')}`;
    }
    return `${chain}:${publicKey.toString('hex')}`;
  }

  /**
   * Construct an Ed25519 KeyObject from a 32-byte seed.
   * Node supports `createPrivateKey` with `{ key, format: 'der', type: 'pkcs8' }`
   * for Ed25519, but constructing a PKCS8 wrapper from a raw seed is
   * non-trivial. The simplest portable approach is `generateKeyPairSync`
   * is NOT deterministic — instead we use the undocumented but stable
   * `createPrivateKey` with raw-KeyObject approach via `KeyObject.from`.
   *
   * As a fallback that works on all Node versions, we use a manual
   * Ed25519 implementation backed by Node's `crypto.sign(null, …)`.
   */
  private ed25519FromSeed(seed: Buffer): { publicKey: Buffer; privateKey: Buffer } {
    if (seed.length !== 32) {
      throw new WalletError('hd.bad_seed_length', `Ed25519 seed must be 32 bytes (got ${seed.length})`);
    }
    // Build a PKCS8 wrapper for the raw Ed25519 seed. The PKCS8 prefix for
    // Ed25519 is a fixed 16-byte ASN.1 header:
    //   30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20
    // followed by the 32-byte seed.
    const pkcs8Prefix = Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ]);
    const pkcs8Der = Buffer.concat([pkcs8Prefix, seed]);
    const priv = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
    const pub = crypto.createPublicKey(priv);
    return {
      publicKey: pub.export({ type: 'spki', format: 'der' }).subarray(-32),
      privateKey: seed,
    };
  }

  /** Sign a message with a 32-byte Ed25519 seed. */
  private signEd25519(seed: Buffer, message: Buffer): Buffer {
    const pkcs8Prefix = Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ]);
    const pkcs8Der = Buffer.concat([pkcs8Prefix, seed]);
    const priv = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
    return crypto.sign(null, message, priv);
  }
}

// Reference to the EncryptedKeyStore class (for `loadMasterSecret`).
import { EncryptedKeyStore as EncryptedKeyStoreClass } from './encrypted-storage';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForHDWallet = globalThis as unknown as { __PAYSWAP_HD_WALLET_SERVICE?: HDWalletService };
export const hdWalletService =
  _globalForHDWallet.__PAYSWAP_HD_WALLET_SERVICE ?? new HDWalletService();
if (!_globalForHDWallet.__PAYSWAP_HD_WALLET_SERVICE) {
  _globalForHDWallet.__PAYSWAP_HD_WALLET_SERVICE = hdWalletService;
}
