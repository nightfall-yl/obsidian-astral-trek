export type NumericSettingKey =
  | "textSmall"
  | "lineHeight"
  | "lineWidth"
  | "lineWidthWide"
  | "maxWidth";

export interface MinimalSettings {
  lightStyle: string;
  darkStyle: string;
  lightScheme: string;
  darkScheme: string;
  colorfulHeadings: boolean;
  colorfulFrame: boolean;
  colorfulActiveStates: boolean;
  trimNames: boolean;
  labeledNav: boolean;
  bordersToggle: boolean;
  focusMode: boolean;
  lineHeight: number;
  lineWidth: number;
  lineWidthWide: number;
  maxWidth: number;
  imgGrid: boolean;
  tableWidth: string;
  iframeWidth: string;
  imgWidth: string;
  chartWidth: string;
  mapWidth: string;
  fullWidthMedia: boolean;
  minimalStatus: boolean;
  textNormal: number;
  textSmall: number;
  underlineInternal: boolean;
  underlineExternal: boolean;
  folding: boolean;
  lineNumbers: boolean;
  readableLineLength: boolean;
  /** 设置组「显示设置项」开关：控制 Minimal 组内各设置项的显隐（默认收起）。 */
  showSettings: boolean;
}

export const DEFAULT_SETTINGS: MinimalSettings = {
  lightStyle: "minimal-light",
  darkStyle: "minimal-dark",
  lightScheme: "minimal-default-light",
  darkScheme: "minimal-default-dark",
  lineHeight: 1.5,
  lineWidth: 40,
  lineWidthWide: 50,
  maxWidth: 88,
  textNormal: 16,
  textSmall: 13,
  imgGrid: false,
  imgWidth: "img-default-width",
  tableWidth: "table-default-width",
  iframeWidth: "iframe-default-width",
  mapWidth: "map-default-width",
  chartWidth: "chart-default-width",
  colorfulHeadings: false,
  colorfulFrame: false,
  colorfulActiveStates: false,
  trimNames: true,
  labeledNav: false,
  fullWidthMedia: true,
  bordersToggle: true,
  minimalStatus: true,
  focusMode: false,
  underlineInternal: true,
  underlineExternal: true,
  folding: true,
  lineNumbers: false,
  readableLineLength: false,
  showSettings: false,
};