import { beforeEach, describe, expect, it, vi } from "vitest";

const { stat, read, stream } = vi.hoisted(() => ({
  stat: vi.fn(),
  read: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("../bridge", () => ({
  bridge: { statReference: stat, readReference: read, referenceStreamUrl: stream },
}));

import {
  forgetProjectReferences,
  forgetReference,
  readReferenceBytes,
  readReferenceParts,
  referenceUrl,
} from "../references";

const created: Blob[] = [];
const revoked: string[] = [];
beforeEach(async () => {
  stat.mockReset();
  read.mockReset();
  stream.mockReset();
  stream.mockResolvedValue(null);
  created.length = 0;
  revoked.length = 0;
  let n = 0;
  URL.createObjectURL = ((b: Blob) => {
    created.push(b);
    return `blob:${++n}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((u: string) => void revoked.push(u)) as typeof URL.revokeObjectURL;
  forgetProjectReferences("/p");
  forgetProjectReferences("/q");
  await new Promise((r) => setTimeout(r)); // earlier tests' revocations run asynchronously
  revoked.length = 0;
});

const serve = (bytes: number[], chunk = 3) => {
  stat.mockResolvedValue({ size: bytes.length, kind: "other" });
  read.mockImplementation(async (_r: string, _p: string, offset: number) =>
    Uint8Array.from(bytes.slice(offset, offset + chunk)),
  );
};

describe("reading a reference file", () => {
  it("reads in chunks until the whole file is there", async () => {
    serve([1, 2, 3, 4, 5, 6, 7]);
    const parts = await readReferenceParts("/p", "references/a.bin");
    expect(parts.map((p) => [...p])).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(read).toHaveBeenCalledWith("/p", "references/a.bin", 3, 8 * 1024 * 1024);
    expect([...(await readReferenceBytes("/p", "references/a.bin"))]).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
  it("stops when the file shrank while it was being read", async () => {
    stat.mockResolvedValue({ size: 10, kind: "other" });
    read.mockResolvedValueOnce(Uint8Array.from([1, 2])).mockResolvedValueOnce(new Uint8Array());
    expect((await readReferenceParts("/p", "references/a.bin")).length).toBe(1);
  });
  it("an empty file has no parts", async () => {
    stat.mockResolvedValue({ size: 0, kind: "other" });
    expect(await readReferenceBytes("/p", "references/a.bin")).toEqual(new Uint8Array());
  });
});

describe("referenceUrl for audio and video", () => {
  it("streams from the scheme URL without reading the file", async () => {
    stream.mockResolvedValue("cadabra-ref://localhost/tok/a.mp4");
    expect(await referenceUrl("/p", "references/a.mp4")).toBe("cadabra-ref://localhost/tok/a.mp4");
    expect(await referenceUrl("/p", "references/a.mp4")).toBe("cadabra-ref://localhost/tok/a.mp4");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledWith("/p", "references/a.mp4");
    expect(stat).not.toHaveBeenCalled();
    expect(created).toEqual([]);
    forgetReference("/p", "references/a.mp4");
  });
  it("streams audio too, but never images, PDFs or text", async () => {
    stream.mockResolvedValue("cadabra-ref://localhost/tok/x");
    expect(await referenceUrl("/p", "references/a.mp3")).toBe("cadabra-ref://localhost/tok/x");
    serve([1, 2]);
    for (const f of ["a.png", "a.pdf", "a.txt"]) await referenceUrl("/p", `references/${f}`);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(created.length).toBe(3);
  });
  it("falls back to a Blob when the host has no scheme, and when the lookup fails nothing is cached", async () => {
    serve([1, 2, 3]);
    expect(await referenceUrl("/p", "references/a.webm")).toBe("blob:1");
    expect(created[0]!.type).toBe("video/webm");
    forgetReference("/p", "references/a.webm");
    stream.mockRejectedValueOnce(new Error("refused"));
    await expect(referenceUrl("/p", "references/a.webm")).rejects.toThrow("refused");
    expect(await referenceUrl("/p", "references/a.webm")).toBe("blob:2");
  });
});

describe("referenceUrl", () => {
  it("builds one blob URL with the media type and reuses it", async () => {
    serve([1, 2, 3, 4]);
    const url = await referenceUrl("/p", "references/a.pdf");
    expect(url).toBe("blob:1");
    expect(created[0]!.type).toBe("application/pdf");
    expect(created[0]!.size).toBe(4);
    expect(await referenceUrl("/p", "references/a.pdf")).toBe(url);
    expect(stat).toHaveBeenCalledTimes(1);
  });
  it("does not cache a failed read", async () => {
    stat.mockRejectedValueOnce(new Error("gone"));
    await expect(referenceUrl("/p", "references/a.pdf")).rejects.toThrow("gone");
    serve([1]);
    expect(await referenceUrl("/p", "references/a.pdf")).toBe("blob:1");
  });
  it("forgets one file or every file of a project, revoking the URLs", async () => {
    serve([1]);
    await referenceUrl("/p", "references/a.pdf");
    await referenceUrl("/p", "references/b.pdf");
    await referenceUrl("/q", "references/a.pdf");
    forgetReference("/p", "references/a.pdf");
    await Promise.resolve();
    expect(revoked).toEqual(["blob:1"]);
    forgetProjectReferences("/p");
    await Promise.resolve();
    expect(revoked).toEqual(["blob:1", "blob:2"]);
    forgetReference("/p", "references/none.pdf");
    stat.mockRejectedValueOnce(new Error("x"));
    const failing = referenceUrl("/q", "references/z.pdf");
    forgetProjectReferences("/q");
    await expect(failing).rejects.toThrow("x");
    await Promise.resolve();
    expect(revoked).toEqual(["blob:1", "blob:2", "blob:3"]);
  });
});
