"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { savePushSubscription, removePushSubscription, testPushNotification } from "@/server/push-actions";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
function keyBytes(value: string) {
  const raw = atob(value.replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
export function PushSettings() {
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(false);
  const [installNeeded, setInstallNeeded] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setInstallNeeded(ios && !window.matchMedia("(display-mode: standalone)").matches && !(navigator as Navigator & { standalone?: boolean }).standalone);
    const available = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(available);
    if (!available) return;
    setPermission(Notification.permission);
    let disposed = false;
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(async (registration) => {
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription || Notification.permission !== "granted") return;
      const saved = await savePushSubscription(subscription.toJSON());
      if (!disposed && saved.id) setDeviceId(saved.id);
    }).catch(() => {});
    return () => { disposed = true; };
  }, []);

  async function enable() {
    setBusy(true); setMessage("");
    try {
      // Permission request stays directly inside the user's click, required on iOS.
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") { setMessage("Notifications were not allowed. You can change this in your browser or device settings."); return; }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) });
      const saved = await savePushSubscription(subscription.toJSON());
      if (saved.error || !saved.id) throw new Error(saved.error);
      setDeviceId(saved.id);
      setMessage("Notifications enabled on this device. Send a test to check delivery.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn't enable notifications. Please try again."); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const removed = await removePushSubscription(subscription.endpoint);
        if (removed.error) throw new Error(removed.error);
        await subscription.unsubscribe();
      }
      setDeviceId(null); setMessage("Notifications disabled on this device.");
    } catch { setMessage("Couldn't disable notifications. Please try again."); }
    finally { setBusy(false); }
  }
  async function test() {
    if (!deviceId) return;
    setBusy(true);
    const result = await testPushNotification(deviceId);
    setMessage(result.error ?? "Test sent. Check your device's notifications.");
    setBusy(false);
  }
  return <>
    <Button variant="outline" size="sm" className="ml-auto" onClick={() => setOpen(true)}><Bell aria-hidden className="size-4" /><span>Notifications</span></Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Task notifications</DialogTitle><DialogDescription>Receive urgent and critical fuse alerts, even when Fuse is closed.</DialogDescription></DialogHeader>
        <p className="text-sm text-muted-foreground">Alerts respect emergency pauses and “bother me after”. Enable them separately on each device.</p>
        {installNeeded ? <p className="text-sm">On iPhone or iPad, open Fuse in Safari, choose Share → Add to Home Screen, then open the installed app to enable notifications. Requires iOS 16.4 or later.</p>
          : !supported ? <p className="text-sm">This browser does not support push notifications. Try an updated Chrome or an installed PWA.</p>
          : !publicKey ? <p className="text-sm">Notifications are being configured. Please try again later.</p>
          : permission === "denied" ? <p className="text-sm">Notifications are blocked. Allow them in the browser or device settings, then reopen Fuse.</p>
          : <div className="flex flex-wrap gap-2">
            {deviceId ? <><Button disabled={busy} onClick={test}>Send test</Button><Button variant="outline" disabled={busy} onClick={disable}>Disable on this device</Button></>
              : <Button disabled={busy} onClick={enable}>{busy ? "Enabling…" : "Enable notifications"}</Button>}
          </div>}
        {message && <p role="status" className="text-sm">{message}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
