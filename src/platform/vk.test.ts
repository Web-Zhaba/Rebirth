import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@vkontakte/vk-bridge");
  vi.unstubAllGlobals();
});

it("resumes VK only after both the ad and the hidden view have cleared", async () => {
  let notify!: (event: { detail: { type: string } }) => void;
  let offerAd = false;
  let finishAd!: (result: { result: boolean }) => void;
  const result = new Promise<{ result: boolean }>((resolve) => { finishAd = resolve; });
  const send = vi.fn(async (name: string) => {
    if (name === "VKWebAppCheckNativeAds") return { result: offerAd };
    if (name === "VKWebAppShowNativeAds") return result;
    return { result: true };
  });
  vi.doMock("@vkontakte/vk-bridge", () => ({
    default: { isEmbedded: () => true, send, subscribe: (fn: typeof notify) => { notify = fn; } },
    parseURLSearchParamsForGetLaunchParams: () => ({}),
  }));
  vi.stubGlobal("location", { search: "" });
  const { initVk } = await import("./vk");
  const platform = await initVk(new AbortController().signal);
  const pause = vi.fn();
  const resume = vi.fn();
  const emit = (type: string) => notify({ detail: { type } });

  emit("VKWebAppViewHide");
  platform.listen({ pause, resume });
  expect(pause).toHaveBeenCalledOnce();
  expect(await platform.rewarded!()).toBe(false);
  expect(resume).not.toHaveBeenCalled();

  offerAd = true;
  const watching = platform.rewarded!();
  await Promise.resolve();
  expect(send).toHaveBeenCalledWith("VKWebAppShowNativeAds", { ad_format: "reward" });
  emit("VKWebAppViewRestore");
  expect(resume).not.toHaveBeenCalled();
  emit("VKWebAppViewHide");
  finishAd({ result: true });
  expect(await watching).toBe(true);
  expect(resume).not.toHaveBeenCalled();
  emit("VKWebAppViewRestore");
  expect(resume).toHaveBeenCalledOnce();
});
