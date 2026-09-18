const params=new URLSearchParams(location.hash.slice(1));
let token=params.get('pair');
history.replaceState(null,'',location.pathname);
const button=document.querySelector('#pair'),result=document.querySelector('#result');
if(token&&/^[A-Za-z0-9_-]{43}$/.test(token)){button.hidden=false;result.textContent='This link can connect one browser and expires after five minutes.';}
else{token=null;result.textContent='Open a fresh pairing link from your PC to connect a new browser.';}
button.addEventListener('click',async()=>{
  button.disabled=true;result.textContent='Connecting securely…';
  try{const response=await fetch('/phone/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),redirect:'error'});const value=await response.json();if(!response.ok)throw Error(value.error||'Pairing failed');token=null;location.replace('/#map');}
  catch(error){result.textContent=error.message;button.disabled=false;}
});
