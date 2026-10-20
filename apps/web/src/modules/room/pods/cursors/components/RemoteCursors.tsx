import { DiagramMarker } from '@designroom/diagram';
import { usePresenceStore } from '../../../store/presenceStore.ts';

export type RemoteCursorsProps = {
  /** The app's presence store unless a test passes its own. */
  store?: typeof usePresenceStore;
};

/** Everyone else's pointer on the board, with their name. Render it as a child of the canvas. */
export function RemoteCursors({ store = usePresenceStore }: RemoteCursorsProps) {
  const others = store((s) => s.others);
  return others.map(
    (person) =>
      person.cursor && (
        <DiagramMarker key={person.id} position={person.cursor}>
          <div
            // A runtime colour from the theme's person palette (index.css): inline style.
            style={{ color: `var(--color-person-${person.color})` }}
            className="flex items-start"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
              <path d="M1 1 L15 7 L8 8.5 L6 15 Z" fill="currentColor" stroke="white" />
            </svg>
            <span
              style={{ backgroundColor: `var(--color-person-${person.color})` }}
              className="mt-3 rounded px-1.5 py-0.5 text-xs whitespace-nowrap text-white shadow-sm"
            >
              {person.name}
            </span>
          </div>
        </DiagramMarker>
      ),
  );
}
