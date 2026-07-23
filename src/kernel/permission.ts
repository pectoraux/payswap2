/**
 * Permission Engine — capability-based access control over kernel actions.
 *
 * Actors (services, dashboards, users, extensions) hold a set of granted
 * capabilities. Every kernel mutation requires a capability; the simulator
 * runs with the `kernel:simulate` capability. This keeps the kernel's
 * security model explicit from day one rather than bolted on later.
 */
import { eventEngine } from './event';

export type Capability =
  | 'kernel:simulate'
  | 'kernel:route'
  | 'kernel:settle'
  | 'kernel:reserve:mutate'
  | 'kernel:treasury:read'
  | 'kernel:extension:register'
  | 'kernel:audit:read';

export interface Actor {
  id: string;
  name: string;
  capabilities: Set<Capability>;
}

export class PermissionEngine {
  private actors: Map<string, Actor> = new Map();

  register(actor: Actor): void {
    this.actors.set(actor.id, actor);
  }

  /** Returns true if `actorId` has been granted `cap`. */
  can(actorId: string, cap: Capability): boolean {
    const actor = this.actors.get(actorId);
    if (!actor) return false;
    const granted = actor.capabilities.has(cap);
    eventEngine.emit(
      'permission.check',
      { actorId, capability: cap, granted },
      0,
    );
    return granted;
  }

  /** Throws if the actor lacks the capability — used to guard mutations. */
  authorize(actorId: string, cap: Capability): void {
    if (!this.can(actorId, cap)) {
      throw new Error(`Permission denied: ${actorId} lacks ${cap}`);
    }
  }
}

export const permissionEngine = new PermissionEngine();

// The simulator actor is pre-registered with full kernel capabilities.
permissionEngine.register({
  id: 'simulator',
  name: 'PaySwap Simulator',
  capabilities: new Set<Capability>([
    'kernel:simulate',
    'kernel:route',
    'kernel:settle',
    'kernel:reserve:mutate',
    'kernel:treasury:read',
    'kernel:extension:register',
    'kernel:audit:read',
  ]),
});
