/**
 * QAQC - Drive source bridge
 *
 * Deploy as a Web app that executes as the owner. The folder itself can remain
 * private; the endpoint only exposes direct child spreadsheets from the
 * configured folder and only up to MAX_BYTES per download.
 */
const CONFIG = {
  folderId: "1Vj6Pdzj7in3ol35NzJCKjLAzA2w5tPOX",
  maxBytes: 12 * 1024 * 1024,
  allowedExtensions: ["xlsx", "xls", "csv"]
};

function doGet(e) {
  const parameters = (e && e.parameter) || {};
  const action = String(parameters.action || "list").toLowerCase();
  try {
    if (action === "health") return respond_({ ok: true, action: "health", app: "QAQC - Desmonte", time: new Date().toISOString() }, parameters.callback);
    if (action === "download") return respond_(download_(String(parameters.id || "")), parameters.callback);
    return respond_({ ok: true, action: "list", files: list_(), folderId: CONFIG.folderId, updatedAt: new Date().toISOString() }, parameters.callback);
  } catch (error) {
    return respond_({ ok: false, error: String(error && error.message || error) }, parameters.callback);
  }
}

function list_() {
  const folder = DriveApp.getFolderById(CONFIG.folderId);
  const files = [];
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    const name = file.getName().trim();
    if (/^~\$/.test(name)) continue;
    if (!isAllowed_(name)) continue;
    files.push({
      id: file.getId(),
      name: name,
      mimeType: file.getMimeType(),
      size: file.getSize(),
      updatedAt: file.getLastUpdated().toISOString(),
      downloadAction: "download"
    });
  }
  files.sort(function(a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
  return files;
}

function download_(id) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw new Error("ID de arquivo inválido");
  const file = DriveApp.getFileById(id);
  if (!isDirectChild_(file, CONFIG.folderId)) throw new Error("Arquivo fora da pasta configurada");
  if (!isAllowed_(file.getName())) throw new Error("Tipo de arquivo não permitido");
  const size = file.getSize();
  if (size > CONFIG.maxBytes) throw new Error("Arquivo acima do limite de 12 MB");
  return {
    ok: true,
    action: "download",
    id: id,
    name: file.getName(),
    mimeType: file.getMimeType(),
    size: size,
    updatedAt: file.getLastUpdated().toISOString(),
    base64: Utilities.base64Encode(file.getBlob().getBytes())
  };
}

function isAllowed_(name) {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return !!match && CONFIG.allowedExtensions.indexOf(match[1]) !== -1;
}

function isDirectChild_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folderId) return true;
  return false;
}

function respond_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
