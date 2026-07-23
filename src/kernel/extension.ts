/**
 * Extension Runtime — a stable hook surface for Milestone-3 extensions.
 *
 * Extensions register against named lifecycle hooks
 * (beforeRoute, afterRoute, beforeSettle, afterSettle, onEvent). The kernel
 * invokes hooks at the right moments; an extension can veto (before*) or
 * observe (after*). In Milestone 1 the runtime is empty by design — the
 * surface exists so later milestones can plug in without touching the kernel.
 */
import { eventEngine } from './event';

export type HookName =
  | 'beforeRoute'
  | 'afterRoute'
  | 'beforeSettle'
  | 'afterSettle'
  | 'onEvent';

export interface Extension {
  id: string;
  name: string;
  version: string;
  hooks: Partial<Record<HookName, (ctx: Record<string, unknown>) => void | boolean>>;
}

export interface ExtensionRegistry {
  list(): Extension[];
  fire(hook: HookName, ctx: Record<string, unknown>): boolean; // false if vetoed
}

export class ExtensionRuntime implements ExtensionRegistry {
  private extensions: Extension[] = [];

  register(ext: Extension): void {
    this.extensions.push(ext);
    eventEngine.emit('extension.registered', { id: ext.id, name: ext.name, version: ext.version }, 0);
  }

  list(): Extension[] {
    return [...this.extensions];
  }

  /** Fire a hook; `before*` hooks may veto by returning false. */
  fire(hook: HookName, ctx: Record<string, unknown>): boolean {
    for (const ext of this.extensions) {
      const fn = ext.hooks[hook];
      if (!fn) continue;
      const result = fn(ctx);
      if (result === false && hook.startsWith('before')) return false;
    }
    return true;
  }
}

export const extensionRuntime = new ExtensionRuntime();
