// swift encode.swift <framesDir> <out.mp4> <width> <height> [fps]
// framesDir/frames.txt: "<file> <seconds>" per line (screencast frames, variable rate); writes constant-fps H.264 MP4.
import AVFoundation
import AppKit
import CoreVideo

let a = CommandLine.arguments
let dir = URL(fileURLWithPath: a[1]), out = URL(fileURLWithPath: a[2])
let W = Int(a[3])!, H = Int(a[4])!, fps = a.count > 5 ? Int32(a[5])! : 25
let raw: String = try! String(contentsOf: dir.appendingPathComponent("frames.txt"), encoding: .utf8)
var list: [(String, Double)] = []
for line in raw.split(separator: "\n") {
  let p: [Substring] = line.split(separator: " ")
  if p.count == 2, let t = Double(String(p[1])) { list.append((String(p[0]), t)) }
}
guard !list.isEmpty else { fatalError("no frames") }
try? FileManager.default.removeItem(at: out)
let w = try! AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 4_000_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalKey: 50]])
input.expectsMediaDataInRealTime = false
let ad = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H])
w.add(input); w.startWriting(); w.startSession(atSourceTime: .zero)

func buffer(_ file: String) -> CVPixelBuffer {
  let img = NSImage(contentsOf: dir.appendingPathComponent(file))!
  var pb: CVPixelBuffer?
  CVPixelBufferCreate(nil, W, H, kCVPixelFormatType_32ARGB, [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary, &pb)
  CVPixelBufferLockBaseAddress(pb!, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb!), width: W, height: H, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pb!),
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
  ctx.setFillColor(CGColor(red: 0.93, green: 0.91, blue: 0.87, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
  var r = CGRect(x: 0, y: 0, width: W, height: H)
  let cg = img.cgImage(forProposedRect: &r, context: nil, hints: nil)!
  ctx.interpolationQuality = .high
  ctx.draw(cg, in: CGRect(x: 0, y: 0, width: W, height: H))
  CVPixelBufferUnlockBaseAddress(pb!, [])
  return pb!
}

let t0 = list[0].1, end = list.last!.1 - t0 + 1.0
let total = Int(end * Double(fps))
var idx = 0, cur: (String, CVPixelBuffer)? = nil
for n in 0..<total {
  let t = Double(n) / Double(fps)
  while idx + 1 < list.count && list[idx + 1].1 - t0 <= t { idx += 1 }
  if cur == nil || cur!.0 != list[idx].0 { cur = (list[idx].0, buffer(list[idx].0)) }
  while !input.isReadyForMoreMediaData { usleep(2000) }
  ad.append(cur!.1, withPresentationTime: CMTime(value: CMTimeValue(n), timescale: fps))
}
input.markAsFinished()
let sem = DispatchSemaphore(value: 0)
w.finishWriting { sem.signal() }
sem.wait()
print("wrote \(out.path): \(total) frames, \(String(format: "%.1f", end)) s, status \(w.status.rawValue) \(w.error?.localizedDescription ?? "")")
