self.onmessage=async(event:MessageEvent<File>)=>{try{const text=await event.data.text(),value=JSON.parse(text);postMessage({ok:true,value})}catch(error){postMessage({ok:false,error:error instanceof Error?error.message:'Archive parsing failed.'})}};
export {};
