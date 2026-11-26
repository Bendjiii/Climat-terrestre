export type ClimateFamilyCode = 'B' | 'C' | 'D' | 'E';
export type PaletteMode = 'natural' | 'beck';

export interface ClimateFamily {
  code: ClimateFamilyCode;
  name: string;
  shortName: string;
  description: string;
}

export interface KoppenClimate {
  id: number;
  code: string;
  family: ClimateFamilyCode;
  name: string;
  koppenCodes: number[];
  color: string;
  rgb: [number, number, number];
  naturalColor: string;
  naturalRgb: [number, number, number];
  description: string;
}

export const CLIMATE_FAMILIES: Record<ClimateFamilyCode, ClimateFamily> = {
  B: {
    code: 'B',
    name: 'Sec / Aride',
    shortName: 'Sec',
    description: 'Précipitations faibles face à l’évaporation.',
  },
  C: {
    code: 'C',
    name: 'Tempéré & Subtropical',
    shortName: 'Tempéré',
    description: 'Saisons marquées avec hivers doux à frais.',
  },
  D: {
    code: 'D',
    name: 'Continental & Subarctique',
    shortName: 'Continental',
    description: 'Hivers froids à rigoureux sous 0 °C.',
  },
  E: {
    code: 'E',
    name: 'Polaire',
    shortName: 'Polaire',
    description: 'Températures estivales inférieures à 10 °C.',
  },
};

/**
 * 7 catégories climatiques essentielles conservées à partir des données
 * Beck et al. (2023), période 1991–2020.
 * Les valeurs raster hors de ces 7 catégories (dont 0 = océan / sans données)
 * ne sont pas affichées sur la carte.
 */
export const ESSENTIAL_CLIMATES: KoppenClimate[] = [
  {
    id: 1,
    code: 'B',
    family: 'B',
    name: 'Climat subtropical sec',
    koppenCodes: [4, 5, 6, 7],
    color: '#F57C00',
    rgb: [245, 124, 0],
    naturalColor: '#E06D2B',
    naturalRgb: [224, 109, 43],
    description:
      'Zones arides et semi-arides (déserts et steppes) caractérisées par de faibles précipitations.',
  },
  {
    id: 2,
    code: 'Cfa/w',
    family: 'C',
    name: 'Climat subtropical humide',
    koppenCodes: [11, 12, 13, 14],
    color: '#A3E635',
    rgb: [163, 230, 53],
    naturalColor: '#74C655',
    naturalRgb: [116, 198, 85],
    description: 'Étés chauds et humides, hivers doux et précipitations abondantes.',
  },
  {
    id: 3,
    code: 'Cs',
    family: 'C',
    name: 'Climat méditerranéen',
    koppenCodes: [8, 9, 10],
    color: '#FFFF00',
    rgb: [255, 255, 0],
    naturalColor: '#EAB308',
    naturalRgb: [234, 179, 8],
    description: 'Étés chauds et secs, hivers doux et humides.',
  },
  {
    id: 4,
    code: 'Cfb/c',
    family: 'C',
    name: 'Climat tempéré océanique',
    koppenCodes: [15, 16],
    color: '#4ADE80',
    rgb: [74, 222, 128],
    naturalColor: '#2BB5A0',
    naturalRgb: [43, 181, 160],
    description:
      'Étés tempérés, hivers doux et pluies régulières sous influence maritime.',
  },
  {
    id: 5,
    code: 'Dfa/b',
    family: 'D',
    name: 'Climat tempéré continental',
    koppenCodes: [17, 18, 21, 22, 25, 26],
    color: '#00D8FF',
    rgb: [0, 216, 255],
    naturalColor: '#3B9EE8',
    naturalRgb: [59, 158, 232],
    description:
      'Forte amplitude thermique entre étés chauds ou tempérés et hivers froids et enneigés.',
  },
  {
    id: 6,
    code: 'Dfc/d',
    family: 'D',
    name: 'Climat subarctique',
    koppenCodes: [19, 20, 23, 24, 27, 28],
    color: '#007D7D',
    rgb: [0, 125, 125],
    naturalColor: '#3B52A8',
    naturalRgb: [59, 82, 168],
    description:
      'Étés très courts et frais, hivers longs et rigoureux (domaine boréal et taïga).',
  },
  {
    id: 7,
    code: 'E',
    family: 'E',
    name: 'Climat polaire',
    koppenCodes: [29, 30],
    color: '#B2B2B2',
    rgb: [178, 178, 178],
    naturalColor: '#DCE8F2',
    naturalRgb: [220, 232, 242],
    description:
      'Froid permanent ou étés inférieurs à 10 °C (toundra et calottes glaciaires).',
  },
];

export const KOPPEN_CLIMATES: Record<number, KoppenClimate> = {};
for (const climate of ESSENTIAL_CLIMATES) {
  for (const rawCode of climate.koppenCodes) {
    KOPPEN_CLIMATES[rawCode] = climate;
  }
}

export function getEssentialClimateByRasterCode(
  rasterCode: number | null | undefined
): KoppenClimate | null {
  if (
    typeof rasterCode !== 'number' ||
    !Number.isInteger(rasterCode) ||
    rasterCode < 1 ||
    rasterCode > 30
  ) {
    return null;
  }
  return KOPPEN_CLIMATES[rasterCode] ?? null;
}

export function getClimateColor(
  climate: KoppenClimate,
  mode: PaletteMode
): string {
  return mode === 'natural' ? climate.naturalColor : climate.color;
}

export function getClimateRgb(
  climate: KoppenClimate,
  mode: PaletteMode
): [number, number, number] {
  return mode === 'natural' ? climate.naturalRgb : climate.rgb;
}

export function formatLat(lat: number): string {
  const abs = Math.abs(lat).toFixed(3);
  return `${abs}° ${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLon(lon: number): string {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const abs = Math.abs(wrapped).toFixed(3);
  return `${abs}° ${wrapped >= 0 ? 'E' : 'O'}`;
}
