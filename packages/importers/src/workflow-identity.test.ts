import {it,expect} from 'vitest';
import {parseBrowserFile,buildCanonicalDataset} from './index';
it('keeps equal-length same-name files distinct and retains original bytes',async()=>{
 const a=await parseBrowserFile(new File(['Sample\tTarget\tCq\nS1\tREF\t20'],'run.tsv'));
 const b=await parseBrowserFile(new File(['Sample\tTarget\tCq\nS1\tREF\t21'],'run.tsv'));
 expect(a.id).not.toBe(b.id);
 expect(a.metadata.contentSha256).toHaveLength(64);
 expect(atob(a.metadata.originalBytesBase64)).toContain('20');
});

it('does not merge different sample IDs that share a name',async()=>{
 const source=await parseBrowserFile(new File(['Well\tSample Name\tSample ID\tTarget\tCq\nA1\tSame\tid-A\tREF\t20\nA2\tSame\tid-B\tREF\t24'],'ids.tsv'));
 const dataset=buildCanonicalDataset([source]);
 expect(new Set(dataset.wells.filter(w=>w.cq!==null).map(w=>w.sampleName)).size).toBe(2);
 expect(dataset.wells.filter(w=>w.cq!==null).map(w=>w.cq)).toEqual([20,24]);
});
it('keeps one stable ID together when a display name is corrected',async()=>{
 const source=await parseBrowserFile(new File(['Well\tSample Name\tSample ID\tTarget\tCq\nA1\tOld name\tid-A\tREF\t20\nA2\tCorrected name\tid-A\tREF\t20.2'],'corrected.tsv'));
 const dataset=buildCanonicalDataset([source]);
 expect(new Set(dataset.wells.filter(w=>w.cq!==null).map(w=>w.sampleName)).size).toBe(1);
});
