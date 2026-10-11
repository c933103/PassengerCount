// A pending selection is durable before native cleanup, and stays retryable
// until both cleanup and the final workspace write have been acknowledged.
export function deleteRecords(state, requestedIds, bridge, save) {
  const ids = [...new Set([...(state.deletingIds || []), ...requestedIds])];
  if (!ids.length) return;
  const selected = new Set(ids);
  const commit = next => {
    if (save(next) === false) throw Error('Record deletion could not be saved');
    Object.assign(state, next);
  };
  const remaining = () => ({ ...state,
    currentId: selected.has(state.currentId) ? null : state.currentId,
    screen: selected.has(state.currentId) ? 'home' : state.screen,
    surveys: state.surveys.filter(s => !selected.has(s.id)),
    deletingIds: [],
  });
  if (!bridge) {
    if (state.deletingIds?.length) throw Error('Native record cleanup is unavailable');
    commit(remaining()); return;
  }
  // An older native bridge cannot acknowledge removal of its journal files.
  if (typeof bridge.deleteTrack !== 'function') throw Error('Native record cleanup is unavailable');
  commit({ ...state, deletingIds: ids,
    currentId: selected.has(state.currentId) ? null : state.currentId,
    screen: selected.has(state.currentId) ? 'home' : state.screen,
  });
  for (const id of ids) {
    if (bridge.deleteTrack(id) !== true) throw Error('Native record cleanup is incomplete');
  }
  commit(remaining());
}
