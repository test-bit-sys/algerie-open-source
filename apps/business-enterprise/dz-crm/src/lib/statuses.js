/**
 * The small fixed vocabularies the whole app shares: where a person sits
 * with you, and the kinds of touch you can log. Kept apart from the store
 * so the CSV and reporting layers can read them without importing the
 * data layer they feed.
 */
export const CONTACT_STATUSES = [
  { value: 'lead', label: 'Lead' },
  { value: 'active', label: 'In conversation' },
  { value: 'customer', label: 'Customer' },
  { value: 'lost', label: 'Lost touch' },
];

/** The kinds of touch that can be logged against a record. */
export const ACTIVITY_TYPES = [
  { value: 'meeting', label: 'Meeting', icon: 'video' },
  { value: 'call', label: 'Call', icon: 'phone' },
  { value: 'email', label: 'Email', icon: 'mail' },
  { value: 'note', label: 'Note', icon: 'note' },
];

/** The type record for an id; an unknown one reads as a note. */
export function activityTypeInfo(type) {
  return ACTIVITY_TYPES.find((t) => t.value === type) || ACTIVITY_TYPES[3];
}
