import type { ControllerPad } from './gamepads';

/** Normalises USB, Bluetooth basic and Bluetooth extended reports to the standard button mapping. */
export function decodeDualSenseInput(reportId: number, data: DataView): ControllerPad | null {
  const basic = reportId === 0x01 && data.byteLength === 9;
  const offset = reportId === 0x31 && data.byteLength >= 54 ? 1 : 0;
  if (!basic && !(reportId === 0x01 && data.byteLength >= 63) && !(reportId === 0x31 && offset === 1)) return null;
  const buttonsOffset = basic ? 4 : offset + 7;
  const face = data.getUint8(buttonsOffset);
  const shoulders = data.getUint8(buttonsOffset + 1);
  const system = data.getUint8(buttonsOffset + 2);
  const dpad = face & 15;
  const trigger = basic ? 7 : offset + 4;
  const values = [
    face & 0x20 ? 1 : 0,
    face & 0x40 ? 1 : 0,
    face & 0x10 ? 1 : 0,
    face & 0x80 ? 1 : 0,
    shoulders & 1 ? 1 : 0,
    shoulders & 2 ? 1 : 0,
    data.getUint8(trigger) / 255,
    data.getUint8(trigger + 1) / 255,
    shoulders & 0x10 ? 1 : 0,
    shoulders & 0x20 ? 1 : 0,
    shoulders & 0x40 ? 1 : 0,
    shoulders & 0x80 ? 1 : 0,
    [0, 1, 7].includes(dpad) ? 1 : 0,
    [3, 4, 5].includes(dpad) ? 1 : 0,
    [5, 6, 7].includes(dpad) ? 1 : 0,
    [1, 2, 3].includes(dpad) ? 1 : 0,
    system & 1 ? 1 : 0,
    system & 2 ? 1 : 0,
    system & 4 ? 1 : 0,
  ];
  return {
    id: 'DualSense (WebHID)',
    connected: true,
    axes: Array.from({ length: 4 }, (_, index) => Math.max(-1, (data.getUint8(offset + index) - 128) / 127)),
    buttons: values.map((value, index) => ({
      value,
      pressed: value > (index === 6 || index === 7 ? 0.3 : 0),
      touched: value > 0,
    })),
  };
}
