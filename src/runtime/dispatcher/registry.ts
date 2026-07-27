/**
 * Command Handler — processes one command type, produces events.
 * (M-RT-21, Phase 4.)
 *
 * Each capability registers a CommandHandler for each command type it supports.
 * The handler receives the command + current snapshot, and returns:
 *   - events to append (UncommittedEvent[])
 *   - the execution result (for the caller)
 *
 * Handlers are PURE: they don't append events themselves, they don't mutate
 * state. They only COMPUTE what events should be appended. The dispatcher
 * handles the actual append (after invariant verification).
 *
 *   CommandHandler.handle(command, snapshot) → { events, result }
 */

import type { RuntimeCommand, CommandMetadata } from './types';
import type { UncommittedEvent } from '../events';
import type { RuntimeSnapshot } from '../invariants';

/** The result of handling a command (what the dispatcher returns to the caller). */
export interface CommandResult {
  /** Whether the command succeeded. */
  success: boolean;
  /** The command type that was handled. */
  commandType: string;
  /** Events that were produced (and will be appended). */
  events: UncommittedEvent[];
  /** The stream ID (for the caller to reference). */
  streamId?: string;
  /** Human-readable result message. */
  message: string;
  /** The entity ID created/modified (e.g., paymentId, refundId). */
  entityId?: string;
  /** Error message (if success === false). */
  error?: string;
}

/**
 * CommandHandler — processes one command type.
 *
 * Generic over the command type T (so handlers are type-safe).
 */
export interface CommandHandler<T extends RuntimeCommand = RuntimeCommand> {
  /** The command type this handler processes. */
  readonly commandType: string;
  /** Human-readable description. */
  readonly description: string;

  /**
   * Handle a command. PURE: no side effects.
   *
   * @param command  The command to handle.
   * @param snapshot The current runtime snapshot (read-only).
   * @returns The events to append + the result for the caller.
   */
  handle(command: T, snapshot: RuntimeSnapshot): Promise<CommandResult> | CommandResult;
}

/**
 * CommandRegistry — holds all registered command handlers.
 *
 * The dispatcher looks up the handler by command type. If no handler is
 * registered, the command is rejected.
 */
export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();

  /** Register a command handler. */
  register(handler: CommandHandler): void {
    if (this.handlers.has(handler.commandType)) {
      throw new Error(`Duplicate command handler for type: ${handler.commandType}`);
    }
    this.handlers.set(handler.commandType, handler);
  }

  /** Get the handler for a command type (or null). */
  get(commandType: string): CommandHandler | null {
    return this.handlers.get(commandType) ?? null;
  }

  /** List all registered command types. */
  types(): string[] {
    return [...this.handlers.keys()];
  }

  /** Check if a command type is registered. */
  has(commandType: string): boolean {
    return this.handlers.has(commandType);
  }
}
