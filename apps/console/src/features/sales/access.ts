// The one place that decides what a role may do in the rep portal. Real sign-in (Cloudflare Access plus a rep role) will
// replace where the role comes from, not this table. packages/db has no sales actions yet, so the check lives here.
import type { Role } from '@/lib/api/types';

export interface SalesAccess {
  /** Opens the rep portal at all. */
  portal: boolean;
  /** Sees every rep's deals; a rep sees only their own. */
  allDeals: boolean;
  /** Edits the price config and flips quoting on or off. Christian's call, so admin only. */
  editPrices: boolean;
}

const NONE: SalesAccess = { portal: false, allDeals: false, editPrices: false };
const TABLE: Partial<Record<Role, SalesAccess>> = {
  admin: { portal: true, allDeals: true, editPrices: true },
  operator: { portal: true, allDeals: true, editPrices: false },
  rep: { portal: true, allDeals: false, editPrices: false },
};

export const salesAccess = (role: Role): SalesAccess => TABLE[role] ?? NONE;
