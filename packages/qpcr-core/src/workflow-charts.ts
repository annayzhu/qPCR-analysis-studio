/** Presentation only: retain source rows and a common upstream axis across facets. */
export function facetChartRows<T>(rows:readonly T[],size=6):T[][] {
 if(!Number.isInteger(size)||size<1)throw new Error('Invalid facet size');
 return Array.from({length:Math.ceil(rows.length/size)},(_,index)=>rows.slice(index*size,(index+1)*size));
}
