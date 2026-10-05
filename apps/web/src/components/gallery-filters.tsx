import type { GallerySearch } from '../../../../packages/protocol/src';
import type { DiscoveryFacets } from '../../../../packages/protocol/src/topics';

const filters = [
  ['archetype', 'archetypes', 'What it does'],
  ['intent', 'intents', 'Accepted intent'],
  ['requiredDomain', 'requiredDomains', 'Required capability'],
  ['optionalDomain', 'optionalDomains', 'Optional integration'],
] as const;

export function GalleryFilters({
  search,
  facets,
  disabled,
  update,
}: {
  search: GallerySearch;
  facets: DiscoveryFacets;
  disabled: boolean;
  update: (patch: Partial<GallerySearch>) => void;
}) {
  const count = filters.filter(([field]) => search[field]).length;
  return (
    <details className="gallery-filters" open={count > 0 || undefined}>
      <summary>More filters{count > 0 && <span>{count} active</span>}</summary>
      <div className="gallery-filter-fields">
        {filters.map(([field, group, label]) => {
          const selected = search[field] ?? '';
          const options = facets[group];
          return (
            <label key={field}>
              <span>{label}</span>
              <select
                disabled={disabled}
                value={selected}
                onChange={(event) => update({ [field]: event.target.value || undefined })}
              >
                <option value="">Any</option>
                {selected && !options.some((option) => option.value === selected) && (
                  <option value={selected}>{selected} (0)</option>
                )}
                {options.map(({ value, count }) => (
                  <option key={value} value={value}>
                    {value} ({count})
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <p>Find napplets by what their creators advertise. Counts cover this collection.</p>
      {count > 0 && (
        <button
          className="text-link"
          onClick={() =>
            update({
              archetype: undefined,
              intent: undefined,
              requiredDomain: undefined,
              optionalDomain: undefined,
            })
          }
        >
          Clear these filters
        </button>
      )}
    </details>
  );
}
