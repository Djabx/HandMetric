export type Polarity = 'good' | 'bad' | 'neutral';
export type DisplayMode = 'abstinence' | 'frequency';
export type GoalKind = 'max' | 'min';
export type Period = 'day' | 'week' | 'month';
/** Périodes d'affichage : celles des objectifs, plus l'année. */
export type ChartPeriod = Period | 'year';

export interface SyncMeta {
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string;
}

export interface Tracker extends SyncMeta {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  polarity: Polarity;
  display_mode: DisplayMode;
  goal_kind: GoalKind | null;
  goal_count: number | null;
  goal_period: Period | null;
  sort_order: number;
  archived_at: string | null;
  /** Trophées : null = selon le type de compteur, 0 = non, 1 = oui. */
  achievements?: number | null;
}

export interface TrackerField extends SyncMeta {
  id: string;
  tracker_id: string;
  name: string;
  unit: string | null;
  sort_order: number;
}

/** Mesures d'un événement : id du champ → valeur. */
export type Measures = Record<string, number>;

export interface LifeEvent extends SyncMeta {
  id: string;
  tracker_id: string;
  occurred_at: string;
  tz_offset: number;
  measures: Measures | null;
  note: string | null;
}

/** Ligne brute telle que stockée / échangée (measures en JSON texte). */
export type Row = Record<string, string | number | null>;

export interface ChangeSet {
  tracker: Row[];
  tracker_field: Row[];
  event: Row[];
}

export interface MergeSummary {
  inserted: number;
  updated: number;
  ignored: number;
  /** Compteurs présents dans le fichier mais supprimés ici depuis : ils restent dans la corbeille. */
  stillDeleted: number;
  byTable: Record<string, { inserted: number; updated: number; ignored: number }>;
}

export type TrackerInput = Pick<
  Tracker,
  'name' | 'icon' | 'color' | 'polarity' | 'display_mode' | 'goal_kind' | 'goal_count' | 'goal_period' | 'achievements'
> & { id?: string };

export type FieldInput = { id?: string; name: string; unit: string | null };

export type EventInput = {
  id?: string;
  tracker_id: string;
  occurred_at?: string;
  tz_offset?: number;
  measures?: Measures | null;
  note?: string | null;
};
