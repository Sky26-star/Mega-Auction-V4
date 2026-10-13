/**
 * Centralized Monetary Unit Conversion & Formatting Utility for MegaAuction
 *
 * Canonical Database Contract:
 * - All bid amounts, base prices, lot bids, and mandatory reserves are strictly stored in LAKHS.
 * - 1 Crore (Cr) = 100 Lakhs (e.g. 200 Lakhs = ₹2.00 Cr, 10000 Lakhs = ₹100.00 Cr).
 *
 * Room Purse Representation:
 * - Room configuration default_purse / team.purse can be defined in Crores (e.g. 100, 120, 140)
 *   or Lakhs (e.g. 10000, 12000, 14000).
 * - This central utility normalizes any team purse to LAKHS deterministically.
 */

/**
 * Normalizes any team purse input (in Crores or Lakhs) to LAKHS.
 */
export function normalizePurseToLakhs(purse: number | undefined | null): number {
  if (typeof purse !== 'number' || isNaN(purse) || purse <= 0) return 10000;
  // If purse <= 1000 (e.g., 100 Cr, 120 Cr, 140 Cr), convert to Lakhs (* 100)
  return purse <= 1000 ? purse * 100 : purse;
}

/**
 * Converts Lakhs to formatted Crores string (e.g., 200 Lakhs -> "2.00", 10000 Lakhs -> "100.00").
 */
export function formatLakhsToCr(lakhs: number | undefined | null): string {
  if (typeof lakhs !== 'number' || isNaN(lakhs)) return '0.00';
  return (lakhs / 100).toFixed(2);
}
