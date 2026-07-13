import type { CatalogProviderId, SearchMode, SkillSearchResult } from "../types.js";

export interface SkillProvider {
  readonly id: CatalogProviderId;
  readonly name: string;
  readonly requiresAuth: boolean;
  isAvailable(): boolean;
  search(query: string, mode: SearchMode, limit: number): Promise<SkillSearchResult[]>;
}

/**
 * Varying parts used to build a {@link SkillProvider}. The availability check
 * and search implementation are supplied as functions so each provider keeps
 * its own behavior while the shared provider-object shape is constructed in a
 * single place.
 */
export interface SkillProviderInit {
  readonly id: CatalogProviderId;
  readonly name: string;
  readonly requiresAuth: boolean;
  readonly isAvailable: () => boolean;
  readonly search: (query: string, mode: SearchMode, limit: number) => Promise<SkillSearchResult[]>;
}

/**
 * Build a {@link SkillProvider} from a {@link SkillProviderInit}.
 *
 * Consolidates the provider-object construction so the `isAvailable` and
 * `search` accessors live on one object literal instead of being re-declared
 * as shorthand methods in every provider factory.
 */
export function createSkillProvider(init: SkillProviderInit): SkillProvider {
  return {
    id: init.id,
    name: init.name,
    requiresAuth: init.requiresAuth,
    isAvailable: init.isAvailable,
    search: init.search,
  };
}
