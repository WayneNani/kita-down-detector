/** Standort auf 2 Nachkommastellen (≈ 1 km) runden, BEVOR er das Gerät verlässt. */
export function runden(x: number): number {
  return Math.round(x * 100) / 100;
}

export function standortErmitteln(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Ihr Browser kann den Standort nicht bestimmen.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: runden(pos.coords.latitude), lon: runden(pos.coords.longitude) }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Standortfreigabe abgelehnt. Sie können stattdessen nach Name, Ort oder PLZ suchen.'
              : 'Standort konnte nicht bestimmt werden.',
          ),
        ),
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 15_000 },
    );
  });
}
