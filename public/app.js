// Kleine Verbesserungen im Formular. Alles funktioniert auch ohne JavaScript
// (bis auf den Proof-of-Work, der JavaScript braucht).
document.addEventListener('DOMContentLoaded', () => {
  for (const form of document.querySelectorAll('form.meldung')) {
    const zeiten = form.querySelector('[data-zeiten]');
    const von = form.querySelector('input[name=datum_von]');
    const bis = form.querySelector('input[name=datum_bis]');
    const aktualisieren = () => {
      const status = form.querySelector('input[name=status]:checked')?.value;
      if (zeiten) zeiten.hidden = !(status === 'verkuerzt' || status === 'notbetreuung');
    };
    form.addEventListener('change', aktualisieren);
    aktualisieren();
    if (von && bis) {
      von.addEventListener('change', () => {
        bis.min = von.value;
        if (bis.value && bis.value < von.value) bis.value = von.value;
      });
    }
  }
});
