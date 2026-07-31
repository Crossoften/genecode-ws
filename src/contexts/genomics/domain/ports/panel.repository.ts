import type { PanelDefinition } from '../scoring/report-calculator';

export const PANEL_REPOSITORY = Symbol('PANEL_REPOSITORY');

/** Identity of a published panel version. */
export interface PanelRef {
  readonly id: string;
  readonly slug: string;
  readonly version: string;
  readonly name: string;
  readonly scoringModel: 'ADDITIVE' | 'MULTIPLICATIVE';
}

export interface LoadedPanel {
  readonly ref: PanelRef;
  readonly definition: PanelDefinition;
  /** Category slug → display name, for the report. */
  readonly categoryNames: ReadonlyMap<string, string>;
  /** Modality slug → display name. */
  readonly modalityNames: ReadonlyMap<string, string>;
}

/**
 * Loads a panel with everything the calculator needs: markers, weights,
 * genotype scores, modality weights and both percentile curves.
 *
 * It is one heavy read rather than many small ones because the calculator is
 * pure — it receives the whole definition and does no I/O of its own, which is
 * what keeps it unit-testable and lets a batch of 80 patients reuse a single
 * load.
 */
export interface PanelRepository {
  /** Loads the newest published version of a panel, or null. */
  loadPublished(slug: string): Promise<LoadedPanel | null>;

  /** Loads a specific version by id — used when recomputing an existing report. */
  loadById(panelId: string): Promise<LoadedPanel | null>;
}
