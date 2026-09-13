import { LCL_STATE_LABEL, LCL_STATE_TONE } from '../data/lclCapacityMockData';

// Mirrors VesselStatusBadge: domain-specific label/tone lookup rather than the generic keyword
// based StatusBadge, since "Full" here must read as danger and "Limited Space" as warning.
export default function LclCapacityStatusBadge({ state }) {
  const tone = LCL_STATE_TONE[state] || 'neutral';
  return <span className={`pill pill--${tone}`}>{LCL_STATE_LABEL[state] || state}</span>;
}
