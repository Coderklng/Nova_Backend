import { createClient } from "redis";


const redisClient = async ()=>{
     try{
       const client = createClient({
          url:process.env.REDIS_URL ||"redis://localhost:6379"
       }) 
       client.on("error",(error)=>console.error("Redis Client Error",error));
       await client.connect()
     }catch(error){
       console.error("Redis Disconnected Error Raise",error);
     }
}

export default redisClient;
