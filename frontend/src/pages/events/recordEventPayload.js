const SHOWS_INPUTS = ['receiving', 'transformation', 'shipping'];
const SHOWS_OUTPUTS = ['creation', 'receiving', 'transformation'];

export const hasAmendReason = (value) => typeof value === 'string' && value.trim().length > 0;

export const buildEventPayload = ({ formData, inputs, outputs, kdePayload, isAmending }) => {
  let counterpartyInfo;
  if (['receiving', 'shipping'].includes(formData.eventType)) {
    if (formData.counterpartyName || formData.counterpartyLotCode) {
      counterpartyInfo = {};
      if (formData.counterpartyName) counterpartyInfo.name = formData.counterpartyName;
      if (formData.counterpartyLotCode) counterpartyInfo.lotCode = formData.counterpartyLotCode;
    }
  }

  const payload = {
    eventType: formData.eventType,
    locationId: formData.locationId,
    notes: formData.notes,
    eventDatetime: new Date(formData.eventDatetime).toISOString(),
    source: 'manual',
    kdePayload,
    counterpartyInfo,
    inputs: SHOWS_INPUTS.includes(formData.eventType) ? inputs.filter((i) => i.lotId) : [],
    outputs: SHOWS_OUTPUTS.includes(formData.eventType) ? outputs.filter((o) => o.lotId) : [],
  };

  if (isAmending) payload.amendReason = formData.amendReason;

  return payload;
};
