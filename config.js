window.QAQC_CONFIG = {
  // The folder remains private. The Apps Script endpoint reads its direct
  // children as the owner and returns only the allowed workbook payload.
  driveFolderId: "1Vj6Pdzj7in3ol35NzJCKjLAzA2w5tPOX",
  driveFolderUrl: "https://drive.google.com/drive/folders/1Vj6Pdzj7in3ol35NzJCKjLAzA2w5tPOX",
  // Published Apps Script bridge for the folder above. The refresh button and
  // the five-minute poll always consult this endpoint before using the local
  // fixture as a fallback.
  driveIndexUrl: "https://script.google.com/macros/s/AKfycbym67mNLDFZBkC5yt9fPxiv4X0FKD_YfzNnv3ph_5CeOJ9KjQY_hNIujwXydMkpEgx6/exec",
  sampleUrl: "data/sample.json",
  // The source workbook leaves most units out of the headers. Keep this block
  // explicit so the dashboard never silently invents a unit.
  units: {
    depth: "",
    charge: "unid. da fonte",
    stemming: "",
    diameter: "unid. da fonte",
    delay: "ms"
  },
  refreshMs: 300000
};
