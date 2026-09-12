import './emoji-fixture.css';
document.querySelector('#received')!.textContent=JSON.stringify([...new URLSearchParams(location.search)],null,2);
const observed=sessionStorage.getItem('gzk-emoji-fixture');
document.querySelector('#observed')!.textContent=observed?JSON.stringify(JSON.parse(observed),null,2):'没有本地表单观察记录';
