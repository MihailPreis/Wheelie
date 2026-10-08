# DualSense feedback

Open Options → Controls → DualSense in Chrome or Edge on HTTPS (localhost also works).
Connect the controller over Bluetooth, choose **Connect DualSense**, and grant WebHID access once.
Previously authorised controllers reconnect automatically on page load and device reconnection.
Standard controls use the Gamepad API and do not need WebHID permission. A first button press
may be needed before the browser exposes a gamepad. The page cannot pair a controller with the OS.

- **Smooth throttle and brake**: L2/R2 pressure controls the fraction of simulation ticks with
  drive/brake engaged, after a 5% dead zone. The original integer physics and nine replay input codes
  are preserved. This is pulse-density control, rather than changing the original engine forces.
- **Engine audio haptics**: the actual engine audio is tapped before the speaker mute, low-pass
  filtered and converted to stereo signed 8-bit PCM at 3 kHz. Bluetooth report `0x32` carries
  32 stereo samples every 10.67 ms. This is experimental; its timing and feel need hardware testing.
  It is not the Gamepad API's dual-rumble emulation. USB audio haptics are not implemented.
- **Trigger resistance**: off/light/medium/firm resistance on both triggers while riding;
  it is released on pause, blur, backgrounding, playback exit and page exit. USB report `0x02`
  and Bluetooth report `0x31` are supported. Bluetooth packets include CRC32.

The supplied `motorcycle.mp3` is a 48.73-second stereo recording. The idle loop is drawn from
12–15.8 seconds and the rev loop from 23.8–25.3 seconds. Loop joins have an equal-power
crossfade (100 ms at idle, 250 ms for revs),
DC is removed and levels are matched. Trigger pressure blends the two loops and changes their
playback rates, while road speed also contributes to the revs. An exponential glide smooths changes.
Audible output and controller PCM share the same filtered engine signal; muting speakers does not
mute controller feedback. If the MP3 cannot be decoded, the synthesised engine remains available.

The browser/OS Bluetooth stack, controller firmware and other software owning the controller
can affect output. An output error stops streaming and appears on the DualSense settings page.
PCM queues are bounded so stalled Bluetooth writes do not accumulate old audio.

Protocol references:

- [Chrome WebHID](https://developer.chrome.com/docs/capabilities/hid)
- [DualSense Explorer](https://github.com/nondebug/dualsense)
- [Bluetooth PCM packet description](https://github.com/sendement/dualsense-haptics/blob/main/saxense_algo.py)
- [Sony's Linux HID driver](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-playstation.c)

Before release, check on a physical controller: initial permission, reconnect, partial R2/L2
travel, both trigger resistance settings, PCM while accelerating, speaker mute, pause, focus loss,
backgrounding and disconnect. Automated tests validate protocol framing and lifecycle, not feel.
