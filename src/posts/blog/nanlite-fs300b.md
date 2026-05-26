---
title: "Automating the Nanlite FS-300B"
category: "Reverse engineering"
date: "2026-05-20 18:00:00 +00:00"
desc: "Reverse-engineering the Nanlite FS-300B's Bluetooth Mesh + Feasycom TEA stack so I could control it from Linux without the NANLINK app."
thumbnail: "./images/nanlite-fs300b/thumbnail.png"
alt: "Nanlite FS-300B reverse engineering"
---

I have a Nanlite FS-300B LED light on my desk. It's lovely, except that the only sanctioned way to control it is the NANLINK app on a phone. I wanted to control it from a script on my laptop.

How hard could it be?

![Nanlite FS-300B LED light — TODO replace with photo](./images/nanlite-fs300b/thumbnail.jpg)

## What's actually in the box

The FS-300B uses a Feasycom Bluetooth Mesh SoC. That matters, because Nanlite ships several different radio modules across their product line, and they are _not_ interoperable. There are four protocols I'm aware of:

| Protocol                | Radio                     | Devices                   | Encryption        |
| ----------------------- | ------------------------- | ------------------------- | ----------------- |
| RF V1.0                 | nRF24L0 2.4 GHz           | PavoTubeII6C, FC-60B/120B | None              |
| RF V2.0                 | Unknown                   | Newer firmware            | Unknown           |
| BLE "app protocol"      | USR IOT WH-BLE 102        | PavoTubeII6C              | None              |
| **BLE Mesh (Feasycom)** | **Feasycom BLE Mesh SoC** | **FS-300B**               | **AES-CCM + TEA** |

The first three are documented in [vmedea's excellent gist](https://gist.github.com/vmedea/434694c11092261fcac401b7a4b9a741), which I leaned on heavily. The fourth is what I had in front of me, and what I ended up writing up [in a separate doc](https://github.com/nicholasmullikin/nanlite). The good news: all four protocols share the same _application_ layer. Brightness is `0x01`. CCT is `0x03`. Hue is `0x05`. Saturation is `0x0C`. So once you can get a byte through, you already know what bytes to send.

The bad news: the FS-300B requires you to get the bytes through about five layers of envelope first.

## Pulling the keys out of the APK

Standard Bluetooth Mesh is _almost_ enough to talk to the light. It is not _quite_ enough, because Feasycom layered their own TEA-encrypted authentication challenge on top of the standard, on a proprietary GATT service (`0xFFF0`). If you don't pass that handshake, the device silently drops every vendor-model message you send. It will accept your provisioning, configure your app key, bind it to the model — and then quietly throw your "set brightness to 50" packet on the floor.

The TEA key lives inside `libencrypted.so` in the NANLINK Android app. Getting it out went like this:

1. Download the NANLINK APK from APKMirror. It's a "split" APK — the actual native libraries live in a per-architecture split (e.g. `split_config.arm64_v8a.apk`), not the base.
2. Unzip the split. Locate `libencrypted.so`.
3. The 16-byte key is stored as raw bytes (not ASCII hex) immediately after the string `getRandomNumber\0`. One line of Python:

   ```python
   data = open('libencrypted.so', 'rb').read()
   idx = data.find(b'getRandomNumber\x00')
   print(data[idx+16:idx+32].hex())
   ```

4. Save the resulting 32 hex characters as `tea_key.hex`. That's it.

I'm not republishing the key here, because it's Feasycom's. You extract it from the app you presumably already own. The act of extracting it is what makes the rest of this work.

## The protocol stack

Every command I send to the light traverses the following stack. I am not exaggerating.

1. **PB-GATT provisioning** (Mesh Profile 5.4), one time per device. This is the standard Bluetooth Mesh handshake: ECDH on `secp256r1`, AES-CMAC for confirmation values, AES-CCM for the encrypted provisioning data containing `net_key`, `iv_index`, and the assigned `unicast_address`. The provisioning data PDU is 25 bytes plaintext, 33 bytes ciphertext + MIC.
2. **Feasycom TEA authentication** on the `0xFFF0` GATT service, _every connection_. Generate 4 random bytes, pad with 4 zero bytes, TEA-encrypt the 8-byte block, send `"AUTH" + ciphertext + ciphertext` to characteristic `0xFFF2`. The device responds on `0xFFF1`. If it doesn't respond within 2 seconds, retry with fewer TEA rounds (32 → 2 → 1) — this accommodates older Feasycom firmware that ships fewer rounds.
3. **Config AppKey Add** (opcode `0x00`) and **Config Model App Bind** (opcode `0x803D`), encrypted with `dev_key`. Without these, the device drops vendor-model messages even after you authenticate.
4. **Vendor model `0x1111/0x1111`** carrying an 8-byte Feasycom "fast command":

   ```
   0x00 uint8       rollCode      Anti-replay counter, wraps at 0xFF
   0x01 uint8       functionCode  bit5: SET=1/QUERY=0; bit0: needReturn
   0x02 uint8       typeCode      Always 0x01 for light control
   0x03 uint8       optionCode    Parameter (0x01 = brightness, 0x03 = CCT, ...)
   0x04 uint16_be   value         Parameter value
   0x06 uint16_be   channel       0x0000 for unicast
   ```

   `SET brightness to 50` is `XX 20 01 01 00 32 00 00`, where `XX` is the rolling counter. Eleven bytes total, fits cleanly in a single unsegmented access message.

5. **Mesh access layer** AES-CCM, encrypted with the application key.
6. **Mesh transport + network layer**, with another round of AES-CCM and an AES-ECB-based privacy obfuscation pass over the 6-byte network header.
7. **Proxy PDU framing** — segmentation/reassembly, message type `0x00` (Network PDU), wrapped onto GATT characteristic `0x2ADD` of the Mesh Proxy Service (`0x1828`).

Six layers of envelope to make the lamp dimmer.

## The Bluetooth Mesh sample app key, shipped in production

This is my favorite detail.

The Bluetooth Mesh Profile v1.0 specification, §8, contains an _example_ application key for use in test vectors:

```
63964771734fbd76e3b40519d1d94a48
```

Feasycom shipped this _exact key_ in their firmware. Every Feasycom mesh device uses it. So do, presumably, every `MeshManagerApi.java` derivative in the wild. It's hardcoded. You can verify it yourself in the spec.

I want to be clear that this is fine — the network key (which is per-device and randomly generated at provisioning) is what actually authenticates the network. The app key is a separate scope. But there's something delightfully on-brand about an entire IoT product line keying off a value the spec authors used as a placeholder.

## The 24-bit sequence number trap

Bluetooth Mesh requires monotonically increasing 24-bit sequence numbers per source. The device rejects anything it has already seen. If your provisioner crashes and reloads `mesh_keys.json` with a stale `seq` value, the device starts ignoring you, and the only way to recover is to re-provision.

The implementation cheats:

```python
time_seq = (unix_time - 1735689600) // 10   # 10-second intervals since 2025-01-01
seq      = max(saved_seq, time_seq) + 32    # +32 buffer per connection
```

The current `time_seq` value is around 3.5 million, which is far above any realistic stale `saved_seq`, so the sequence is monotonically increasing even if the key file is wiped. The 24-bit space (16,777,215 values) runs out around 2030, at which point an IV Index update — re-provisioning — is required[^1]. I'll be sad to do it, but I have until then.

## What vmedea did for free

The reason this project worked at all is that I wasn't starting from scratch on the application layer. [vmedea's gist](https://gist.github.com/vmedea/434694c11092261fcac401b7a4b9a741) documents the parameter codes for the older nRF24 and USR IOT BLE protocols, and the FS-300B's underlying light-control MCU uses the same numbering scheme — `0x01` brightness, `0x03` CCT, `0x04` green/magenta shift, `0x05` hue, `0x0C` saturation. Once I could get an 8-byte payload through, the meaning of those bytes was already documented by someone else.

Reverse engineering is mostly _nobody handed you the key_, but it is _occasionally_ "the previous person left half the answer in plain sight." That second case is much nicer.

## What this is for

You'd be forgiven for asking: who has the patience for this?

But the layers are not arbitrary. AES-CCM with separate network and application keys is what lets a mesh light bulb relay packets for a neighbor without being able to read them. The `secp256r1` ECDH exchange is what lets a fresh device share keys with a provisioner over an untrusted radio. The privacy obfuscation pass is what keeps a passive sniffer from correlating a source address across messages. Even the rolling counter in the Feasycom fast command is a real anti-replay mechanism. This stack is overkill for a dimmer slider, but the same stack is also what runs in a hospital, a bridge sensor network, and a building's HVAC. It's nice to see it from the inside.

Also, I can finally type `python cli.py brightness 50` and the lamp dims. Worth it.

[^1]: 24 bits, divided into 10-second intervals, gets you about 5.3 years from the 2025-01-01 epoch. After that the IV Index has to update, which is itself a Mesh-spec'd procedure — you don't actually have to re-provision in the strict sense, but it's easier to do.
