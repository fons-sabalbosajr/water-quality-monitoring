// Classifies a field observation note into the topics it mentions, a primary
// animated scene, and a status. Field notes are multi-topic ("High tide,
// presence of fishing boats, few solid waste"), so every topic is detected and
// the most important one drives the scene.
//
// The vocabulary comes from the 2026 workbook notes: "solid waste" is by far
// the most common phrase, which the previous classifier (garbage|trash) never
// matched, so most notes were labelled a generic "Observed".

const TOPICS = [
  // Ordered by priority — the first match is the primary scene. "Rotten" is
  // deliberately absent: in these notes it is rotten leaves / water hyacinth
  // (natural decay, covered by Aquatic Plants), not a contamination alert.
  { id: 'pollution', label: 'Pollution Alert', status: 'critical', re: /\b(oil|grease|sheen|sewage|foul|odou?r|dead\s+fish|fish\s*kill|kill|black(ish)?\s+water|foam|bubbles)\b/ },
  { id: 'waste', label: 'Solid Waste', status: 'watch', re: /\b(solid\s+wastes?|garbage|trash|plastics?|debris|litter|wastes?)\b/ },
  { id: 'discharge', label: 'Discharge', status: 'watch', re: /\b(discharge|drainage|outfall|effluent|canal|pipe)\b/ },
  { id: 'turbid', label: 'Turbid Water', status: 'watch', re: /\b(turbid|muddy|murky|brownish|siltation|sediment)\b/ },
  { id: 'construction', label: 'Construction', status: 'watch', re: /\b(construction|dredg\w*|excavat\w*|quarry\w*|reclamation|equipment)\b/ },
  { id: 'vegetation', label: 'Aquatic Plants', status: 'observed', re: /\b(hyacinths?|algae|algal|vegetation|mangroves?|leaves|grass|plants?)\b/ },
  { id: 'tide', label: 'Tide', status: 'observed', re: /\b(high\s*tide|low\s*tide|tide|wavy|waves|strong\s+current|flood\w*|rain\w*)\b/ },
  { id: 'boats', label: 'Boat Activity', status: 'observed', re: /\b(boats?|fishing|fishers?|vessels?|banca|ships?|tugboats?|ferry|baklads?|fish\s*traps?|fish\s*cages?|cages)\b/ },
  { id: 'bathing', label: 'Bathing / Recreation', status: 'observed', re: /\b(swimming|bathing|surfing|swimmers?|tourists?|recreation\w*|people)\b/ },
  { id: 'calm', label: 'Clear & Calm', status: 'good', re: /\b(calm|clear|clean|normal|good|stable|no\s+(visible|observed|solid|waste))\b/ },
];

const SCENE_STATUS_RANK = { critical: 3, watch: 2, observed: 1, good: 0 };

/**
 * @param {string} value  the observation note
 * @returns {{ scene: string, label: string, status: 'critical'|'watch'|'observed'|'good', tags: string[] }}
 */
export const classifyObservation = (value) => {
  const text = String(value || '').toLowerCase();
  const matched = TOPICS.filter((topic) => topic.re.test(text));
  if (!matched.length) return { scene: 'observed', label: 'Observed', status: 'observed', tags: [] };

  // "No solid waste observed" is good news, not a waste sighting.
  const negatedWaste = /\bno\s+(visible\s+)?(solid\s+)?wastes?\b/.test(text);
  const topics = matched.filter((topic) => !(negatedWaste && topic.id === 'waste'));
  if (!topics.length) return { scene: 'calm', label: 'Clear & Calm', status: 'good', tags: [] };

  const primary = topics[0];
  const status = topics.reduce((worst, topic) => (
    SCENE_STATUS_RANK[topic.status] > SCENE_STATUS_RANK[worst] ? topic.status : worst
  ), primary.status);
  // A calm note that also reports a problem is not "good".
  const finalStatus = status === 'good' && topics.length > 1 ? 'observed' : status;

  let label = primary.label;
  if (primary.id === 'tide') label = /high\s*tide/.test(text) ? 'High Tide' : /low\s*tide/.test(text) ? 'Low Tide' : 'Wavy / Tide';

  return {
    scene: primary.id === 'tide' && /low\s*tide/.test(text) ? 'tide-low' : primary.id,
    label,
    status: finalStatus,
    tags: topics.slice(1).map((topic) => topic.label),
  };
};

export const OBSERVATION_STATUS_LABEL = {
  critical: 'Needs attention',
  watch: 'Watch',
  observed: 'Observed',
  good: 'Good',
};
