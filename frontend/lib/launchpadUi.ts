export const LAUNCHPAD_UI_SETTINGS_EVENT = "launchpad-ui-settings-updated";

export type LaunchpadUiDefaults = {
  collectionName: string;
  collectionDescription: string;
  collectionBannerUrl: string;
  collectionWebsite: string;
  collectionTwitter: string;
};

export type LaunchpadUiSettings = LaunchpadUiDefaults & {
  updatedAt: number;
};

const STORAGE_PREFIX = "launchpad-ui";

const sanitizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const getLaunchpadUiStorageKey = (
  contractAddress?: string,
  chainId?: number | null
) => {
  const normalizedContract = sanitizeString(contractAddress).toLowerCase() || "unknown";
  const normalizedChainId = chainId ?? "unknown";
  return `${STORAGE_PREFIX}:${normalizedContract}:${normalizedChainId}`;
};

export const buildDefaultLaunchpadUiSettings = (
  defaults: LaunchpadUiDefaults
): LaunchpadUiSettings => ({
  ...defaults,
  updatedAt: 0,
});

export const loadLaunchpadUiSettings = (
  storageKey: string,
  defaults: LaunchpadUiDefaults
): LaunchpadUiSettings => {
  const fallback = buildDefaultLaunchpadUiSettings(defaults);
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return {
      collectionName: sanitizeString(parsed?.collectionName) || fallback.collectionName,
      collectionDescription:
        sanitizeString(parsed?.collectionDescription) || fallback.collectionDescription,
      collectionBannerUrl: sanitizeString(parsed?.collectionBannerUrl),
      collectionWebsite: sanitizeString(parsed?.collectionWebsite),
      collectionTwitter: sanitizeString(parsed?.collectionTwitter),
      updatedAt: Number(parsed?.updatedAt) || 0,
    };
  } catch {
    return fallback;
  }
};

export const saveLaunchpadUiSettings = (
  storageKey: string,
  settings: LaunchpadUiSettings
) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(settings));
  window.dispatchEvent(
    new CustomEvent(LAUNCHPAD_UI_SETTINGS_EVENT, {
      detail: {
        key: storageKey,
      },
    })
  );
};
