export type ClimateFamilyCode = 'A' | 'B' | 'C' | 'D' | 'E';

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
  description: string;
}

export const CLIMATE_FAMILIES: Record<ClimateFamilyCode, ClimateFamily> = {
  A: {
    code: 'A',
    name: 'Tropical & Équatorial',
    shortName: 'Tropical',
    description: 'Chaleur constante toute l’année avec pluies abondantes ou saison humide.',
  },
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
 * Grands climats couvrant 100 % des terres émergées (codes 1 à 30),
 * selon la palette « Climat » unique. Seules les zones océaniques (code 0)
 * restent transparentes.
 */
export const ESSENTIAL_CLIMATES: KoppenClimate[] = [
  {
    id: 1,
    code: 'A',
    family: 'A',
    name: 'Climat tropical',
    koppenCodes: [1, 2, 3],
    color: '#16A34A',
    rgb: [22, 163, 74],
    description:
      'Chaleur permanente et pluies abondantes ou saison humide marquée (forêt équatoriale, mousson et savane).',
  },
  {
    id: 2,
    code: 'B',
    family: 'B',
    name: 'Climat subtropical sec',
    koppenCodes: [4, 5, 6, 7],
    color: '#E06D2B',
    rgb: [224, 109, 43],
    description:
      'Zones arides et semi-arides (déserts et steppes) caractérisées par de faibles précipitations.',
  },
  {
    id: 3,
    code: 'Cfa/w',
    family: 'C',
    name: 'Climat subtropical humide',
    koppenCodes: [11, 12, 13, 14],
    color: '#74C655',
    rgb: [116, 198, 85],
    description: 'Étés chauds et humides, hivers doux et précipitations abondantes.',
  },
  {
    id: 4,
    code: 'Cs',
    family: 'C',
    name: 'Climat méditerranéen',
    koppenCodes: [8, 9, 10],
    color: '#EAB308',
    rgb: [234, 179, 8],
    description: 'Étés chauds et secs, hivers doux et humides.',
  },
  {
    id: 5,
    code: 'Cfb/c',
    family: 'C',
    name: 'Climat tempéré océanique',
    koppenCodes: [15, 16],
    color: '#2BB5A0',
    rgb: [43, 181, 160],
    description:
      'Étés tempérés, hivers doux et pluies régulières sous influence maritime.',
  },
  {
    id: 6,
    code: 'Dfa/b',
    family: 'D',
    name: 'Climat tempéré continental',
    koppenCodes: [17, 18, 21, 22, 25, 26],
    color: '#3B9EE8',
    rgb: [59, 158, 232],
    description:
      'Forte amplitude thermique entre étés chauds ou tempérés et hivers froids et enneigés.',
  },
  {
    id: 7,
    code: 'Dfc/d',
    family: 'D',
    name: 'Climat subarctique',
    koppenCodes: [19, 20, 23, 24, 27, 28],
    color: '#3B52A8',
    rgb: [59, 82, 168],
    description:
      'Étés très courts et frais, hivers longs et rigoureux (domaine boréal et taïga).',
  },
  {
    id: 8,
    code: 'E',
    family: 'E',
    name: 'Climat polaire',
    koppenCodes: [29, 30],
    color: '#DCE8F2',
    rgb: [220, 232, 242],
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

export function getClimateColor(climate: KoppenClimate): string {
  return climate.color;
}

export function getClimateRgb(
  climate: KoppenClimate
): [number, number, number] {
  return climate.rgb;
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
