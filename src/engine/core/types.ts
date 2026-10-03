/** Plain JSON data (what saves, flags and snapshots are made of). */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Undo for a registration (listener, system, timer): call once to remove it again. */
export type Disposer = () => void;
