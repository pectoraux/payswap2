/**
 * PaySwap Protocol — Merchant Platform (v2) — Catalogs.
 *
 * Catalogs group product IDs for organisational purposes (e.g. a merchant
 * might have a 'Retail' catalog and a 'Wholesale' catalog). The actual
 * product records live in the original MerchantPlatform; this service only
 * tracks the grouping (product IDs).
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.catalog_created`   — on `createCatalog`.
 *  - `merchant.catalog_product_added`   — on `addProduct`.
 *  - `merchant.catalog_product_removed` — on `removeProduct`.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { uid, nowTs } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { Catalog } from './types';

/**
 * CatalogService owns catalog records and the product-id membership lists.
 */
export class CatalogService {
  private catalogs = new Map<string, Catalog>();

  // ------------------------------------------------------------- createCatalog
  createCatalog(merchantId: string, name: string): Catalog {
    const catalog: Catalog = {
      id: uid('cat'),
      merchantId,
      name,
      products: [],
      createdAt: nowTs(),
    };
    this.catalogs.set(catalog.id, catalog);
    eventEngine.emit('merchant.catalog_created', {
      merchantId,
      catalogId: catalog.id,
      name,
    });
    return catalog;
  }

  // ----------------------------------------------------------------- addProduct
  /**
   * Add a product to a catalog. Idempotent — adding an already-present
   * product is a no-op. Returns the updated catalog or `null` if the
   * catalog does not exist.
   */
  addProduct(catalogId: string, productId: string): Catalog | null {
    const cat = this.catalogs.get(catalogId);
    if (!cat) return null;
    if (!cat.products.includes(productId)) {
      cat.products.push(productId);
      eventEngine.emit('merchant.catalog_product_added', {
        merchantId: cat.merchantId,
        catalogId,
        productId,
      });
    }
    return cat;
  }

  // -------------------------------------------------------------- removeProduct
  /**
   * Remove a product from a catalog. Returns the updated catalog (whether
   * or not the product was present) or `null` if the catalog does not exist.
   */
  removeProduct(catalogId: string, productId: string): Catalog | null {
    const cat = this.catalogs.get(catalogId);
    if (!cat) return null;
    const before = cat.products.length;
    cat.products = cat.products.filter((p) => p !== productId);
    if (cat.products.length !== before) {
      eventEngine.emit('merchant.catalog_product_removed', {
        merchantId: cat.merchantId,
        catalogId,
        productId,
      });
    }
    return cat;
  }

  // -------------------------------------------------------------------- getters
  getCatalog(id: string): Catalog | undefined {
    return this.catalogs.get(id);
  }

  getByMerchant(merchantId: string): Catalog[] {
    return [...this.catalogs.values()].filter((c) => c.merchantId === merchantId);
  }

  /** Return the list of product IDs in a catalog (or `[]` if missing). */
  getProducts(catalogId: string): string[] {
    return this.catalogs.get(catalogId)?.products ?? [];
  }

  all(): Catalog[] {
    return [...this.catalogs.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.catalogs.clear();
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_CATALOG_SERVICE?: CatalogService };
export const catalogService: CatalogService =
  _g.__PAYSWAP_CATALOG_SERVICE ?? new CatalogService();
if (!_g.__PAYSWAP_CATALOG_SERVICE) _g.__PAYSWAP_CATALOG_SERVICE = catalogService;
