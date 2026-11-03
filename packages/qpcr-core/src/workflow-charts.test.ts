import {it,expect} from 'vitest';
import {facetChartRows} from './workflow-charts';
it('all 45 categories occur once, with unchanged values and order',()=>{
 const rows=Array.from({length:45},(_,i)=>({label:`sample ${i}`,rawValue:i+1}));
 const facets=facetChartRows(rows,6);
 expect(facets.map(f=>f.length)).toEqual([6,6,6,6,6,6,6,3]);
 expect(facets.flat()).toEqual(rows);
});
