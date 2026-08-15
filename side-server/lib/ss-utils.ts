export const Table = (title: string, headerRow: string[], dataRows: string[][]): string => {
	let output = `<div class="ss-table-container">`;
	output += `<h3 class="ss-table-title">${title}</h3>`;
	output += `<table class="ss-table">`;
	output += `<tr class="ss-table-header">`;
	for (const header of headerRow) { output += `<th>${header}</th>`; }
	output += `</tr>`;
	for (const row of dataRows) {
		output += `<tr class="ss-table-row">`;
		for (const cell of row) { output += `<td>${cell}</td>`; }
		output += `</tr>`;
	}
	output += `</table></div>`;
	return output;
};
