export function isPaidFolderPath(folderId, folders = []) {
  if (!folderId) return false;
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set();
  let current = folderById.get(folderId);

  while (current && !seen.has(current.id)) {
    if (current.parent_id && current.is_paid) return true;
    seen.add(current.id);
    current = current.parent_id ? folderById.get(current.parent_id) : null;
  }

  return false;
}

export function isPublicDemoSet(set = {}, folders = []) {
  return Boolean(set?.id) && !set.is_paid && !isPaidFolderPath(set.folder_id, folders);
}
