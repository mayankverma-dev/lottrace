const pad = (value) => String(value).padStart(2, '0');

export const toDateTimeLocal = (date) => {
  const value = date instanceof Date ? date : new Date(date);

  return [
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  ].join('T');
};

export const fromDateTimeLocal = (value) => {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes);
};
