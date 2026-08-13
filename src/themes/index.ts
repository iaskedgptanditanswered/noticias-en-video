import { insaightsTheme } from './insaights';
import { h2newswebTheme } from './h2newsweb';
import type { Theme } from './types';

export const themes: Record<string, Theme> = {
  insaights: insaightsTheme,
  h2newsweb: h2newswebTheme,
};

export function getTheme(id: string): Theme {
  const theme = themes[id];
  if (!theme) throw new Error(`Theme "${id}" not found`);
  return theme;
}

export type { Theme };
