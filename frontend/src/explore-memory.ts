export const exploreMemory: {
  value: null | {
    region: string;
    search: string;
    category: string;
    theme: string;
    date: string;
    page: number;
    scroll: number;
    center: { latitude: number; longitude: number };
    zoom: number;
  };
} = { value: null };
