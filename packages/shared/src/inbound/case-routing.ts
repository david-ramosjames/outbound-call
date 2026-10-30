import type { InboundConfig } from './config.js';
import type { IntakeFacts } from './facts.js';
import type { InboundCaseType } from './types.js';

/** Case types this firm keeps when it focuses on truck accidents (Trucking Chicas model). */
const OWN_TRUCK_CASE_TYPES: InboundCaseType[] = ['trucking'];

/** Personal injury types a truck-focused line would send to a general PI partner. */
const PARTNER_PI_CASE_TYPES: InboundCaseType[] = [
  'motor_vehicle',
  'pedestrian',
  'bicycle',
  'motorcycle',
  'premises_liability',
  'dog_bite',
  'other_personal_injury',
];

/**
 * Whether this line keeps the case (truck / commercial vehicle) rather than
 * sending it to a partner firm. Wrongful death stays with this firm only when a
 * commercial truck was involved; otherwise it goes to the partner.
 */
export function isOwnTruckCase(facts: IntakeFacts): boolean {
  if (facts.commercial_vehicle_involved === true) return true;
  if (facts.case_type && OWN_TRUCK_CASE_TYPES.includes(facts.case_type)) return true;
  return false;
}

/** True when partner routing is on and this is a non-truck PI matter for the partner. */
export function isPartnerPiCase(facts: IntakeFacts, config: InboundConfig): boolean {
  const r = config.routing;
  if (!r.partner_handles_non_truck_pi || !r.partner_transfer_number.trim()) return false;
  if (facts.caller_type && facts.caller_type !== 'new_potential_client') return false;
  if (isOwnTruckCase(facts)) return false;
  if (facts.case_type === 'wrongful_death') return true;
  if (facts.case_type && PARTNER_PI_CASE_TYPES.includes(facts.case_type)) return true;
  return false;
}

export function partnerFirmName(config: InboundConfig): string {
  return config.routing.partner_firm_name.trim() || 'our partner firm';
}
