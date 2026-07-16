# GFU DASH SingleONE Collector

Chrome extension scaffold for sending SingleONE creative thumbnails to GFU DASH.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click `Load unpacked`.
4. Select this folder: `tools/gfu-dash-singleone-extension`.

## Configure

1. Open GFU DASH report lab as an admin.
2. Click the `SingleONE collector` button in GFU DASH.
3. Copy the settings JSON. It includes a short-lived Firebase admin `authToken`.
4. Open this extension popup on a SingleONE creative list page.
5. Paste the settings JSON and save.
6. Click the send button.

The `authToken` normally expires after about one hour. If upload fails with an auth
error, open GFU DASH again, refresh/copy the settings JSON, and paste it into the
extension again.

`collectorToken` is included for future long-lived collector-token operation. That
mode requires the GFU DASH server to have Firebase Admin credentials configured.

Optional selector JSON can be used when automatic row detection is not enough:

```json
{
  "campaignName": ".campaign-name",
  "adgroupName": ".adgroup-name",
  "adName": ".creative-name",
  "image": "img"
}
```

The extension sends:

```json
{
  "brandId": "...",
  "tabId": "...",
  "authToken": "...",
  "assets": [
    {
      "media": "s-meta",
      "campaignName": "...",
      "adgroupName": "...",
      "adName": "...",
      "imageData": "data:image/webp;base64,..."
    }
  ]
}
```

The matching key in GFU DASH is:

```text
media + campaignName + adgroupName + adName
```
