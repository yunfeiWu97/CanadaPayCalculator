interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type StandaloneNavigator = Navigator & { standalone?: boolean };
let initialized = false;

/** Install and update support only. Payroll and user inputs never leave the device. */
export function initPwa(): void {
  if (initialized) return;
  initialized = true;

  const networkStatus = document.querySelector<HTMLElement>("#network-status");
  const updateBanner = document.querySelector<HTMLElement>("#pwa-update-banner");
  const updateButton = document.querySelector<HTMLButtonElement>("#pwa-update-button");
  const installButton = document.querySelector<HTMLButtonElement>("#android-install");
  const installDialog = document.querySelector<HTMLDialogElement>("#install-dialog");
  let installPrompt: InstallPromptEvent | null = null;
  let registration: ServiceWorkerRegistration | undefined;
  let userRequestedUpdate = false;
  let reloadedAfterUpdate = false;

  const isStandalone = (): boolean => window.matchMedia("(display-mode: standalone)").matches
    || (navigator as StandaloneNavigator).standalone === true;

  const showNetworkStatus = (): void => {
    if (!networkStatus) return;
    networkStatus.textContent = navigator.onLine ? "On your device · no account needed" : "Offline · calculations stay on your device";
    networkStatus.dataset.state = navigator.onLine ? "online" : "offline";
  };
  showNetworkStatus();
  window.addEventListener("online", () => {
    showNetworkStatus();
    if (registration) void registration.update().catch(() => undefined);
  });
  window.addEventListener("offline", showNetworkStatus);

  document.querySelectorAll<HTMLButtonElement>("[data-install-help]").forEach(button => {
    button.addEventListener("click", () => {
      if (installDialog && !installDialog.open) installDialog.showModal();
    });
  });

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    if (installButton && !isStandalone()) installButton.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installButton) installButton.hidden = true;
  });
  installButton?.addEventListener("click", () => {
    const prompt = installPrompt;
    if (!prompt) {
      if (installDialog && !installDialog.open) installDialog.showModal();
      return;
    }
    // The browser prompt must be called directly in the user's click handler.
    void prompt.prompt().then(() => prompt.userChoice).then(() => {
      installPrompt = null;
      if (installButton) installButton.hidden = true;
    }).catch(() => {
      installPrompt = null;
      if (installButton) installButton.hidden = true;
      if (installDialog && !installDialog.open) installDialog.showModal();
    });
  });
  if (isStandalone() && installButton) installButton.hidden = true;

  if (!("serviceWorker" in navigator) || !window.isSecureContext || import.meta.env.DEV) return;

  const showWaitingUpdate = (): void => {
    const controller = navigator.serviceWorker.controller;
    const waiting = registration?.waiting;
    // A worker briefly waits during its first installation too. Offer Update
    // only when a different installed worker is replacing an existing one.
    const hasUpdate = Boolean(controller && waiting && waiting !== controller && waiting.state === "installed");
    if (updateBanner) updateBanner.hidden = !hasUpdate;
    if (updateButton) updateButton.disabled = !hasUpdate || userRequestedUpdate;
  };

  updateButton?.addEventListener("click", () => {
    const waitingWorker = registration?.waiting;
    if (!waitingWorker || !navigator.serviceWorker.controller || waitingWorker === navigator.serviceWorker.controller) return;
    userRequestedUpdate = true;
    updateButton.disabled = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    showWaitingUpdate();
    // First installation can claim this page too. Reload only after the user
    // explicitly accepts an update, and only once even if multiple events fire.
    if (!userRequestedUpdate || reloadedAfterUpdate) return;
    reloadedAfterUpdate = true;
    window.location.reload();
  });

  const appBase = new URL(import.meta.env.BASE_URL, window.location.href);
  void navigator.serviceWorker.register(new URL("sw.js", appBase), { scope: appBase.pathname }).then(swRegistration => {
    registration = swRegistration;
    showWaitingUpdate();
    registration.addEventListener("updatefound", () => {
      const installingWorker = registration?.installing;
      installingWorker?.addEventListener("statechange", () => {
        showWaitingUpdate();
      });
    });
    if (registration.installing) {
      const installingWorker = registration.installing;
      installingWorker.addEventListener("statechange", () => {
        showWaitingUpdate();
      });
    }
    if (navigator.onLine) void registration.update().catch(() => undefined);
  }).catch(() => {
    if (networkStatus && navigator.onLine) {
      networkStatus.textContent = "On your device · offline setup unavailable";
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine && registration) {
      void registration.update().catch(() => undefined);
    }
  });
}
