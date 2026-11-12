import { useRef, useSyncExternalStore } from 'react';

const query = '(max-width: 900px)';
function subscribe(callback) {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
function snapshot() {
  return window.matchMedia(query).matches;
}

export default function StudioDrawer({
  title,
  label,
  className = '',
  children
}) {
  const mobile = useSyncExternalStore(subscribe, snapshot, () => false);
  const dialog = useRef(null);
  if (!mobile)
    return (
      <aside className={className} aria-label={title}>
        {children}
      </aside>
    );
  return (
    <>
      <button
        className="studio-button studio-drawer-trigger"
        onClick={() => dialog.current.showModal()}
      >
        {label || title} <span aria-hidden="true">↗</span>
      </button>
      <dialog
        ref={dialog}
        className={`studio-drawer ${className}`}
        aria-label={title}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current.close();
        }}
      >
        <div className="studio-drawer-heading">
          <h2>{title}</h2>
          <button
            className="studio-button"
            onClick={() => dialog.current.close()}
            autoFocus
          >
            Done
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}
