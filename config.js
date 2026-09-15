window.QAQC_CONFIG = {
  // The folder remains private. The Apps Script endpoint reads its direct
  // children as the owner and returns only the allowed workbook payload.
  driveFolderId: "1Vj6Pdzj7in3ol35NzJCKjLAzA2w5tPOX",
  driveFolderUrl: "https://drive.google.com/drive/folders/1Vj6Pdzj7in3ol35NzJCKjLAzA2w5tPOX",
  // Paste the deployed Apps Script Web App URL once. Data changes in Drive
  // then appear through the refresh button and the five-minute poll.
  driveIndexUrl: "",
  sampleUrl: "data/sample.json",
  // The source workbook leaves most units out of the headers. Keep this block
  // explicit so the dashboard never silently invents a unit.
  units: {
    depth: "",
    charge: "unid. fonte",
    stemming: "",
    diameter: "unid. fonte",
    delay: "ms"
  },
  refreshMs: 300000
};
