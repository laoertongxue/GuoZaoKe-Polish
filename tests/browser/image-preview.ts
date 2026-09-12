import { installImagePreview } from '../../src/features/image-preview';
import { defaults } from '../../src/shared/settings';
const enabled=document.querySelector<HTMLInputElement>('#enabled')!;
installImagePreview(()=>({...defaults,imagePreview:enabled.checked}));
