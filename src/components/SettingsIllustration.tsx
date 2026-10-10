import {BookOpen,HardDrive,KeyRound,ShieldCheck,Sparkles} from 'lucide-react';

const scenes={
 vault:{image:'/assets/vault.webp',icon:KeyRound,kicker:'01 / THE VAULT',title:'A quiet place, held by your key.',note:'Your passphrase and recovery key are the way back to your pages.'},
 storage:{image:'/assets/memories.webp',icon:HardDrive,kicker:'02 / YOUR COLLECTION',title:'Every keepsake has a place.',note:'Watch your space as your collection grows. Keep an archive of what matters.'},
 experience:{image:'/assets/room.webp',icon:Sparkles,kicker:'03 / YOUR ATMOSPHERE',title:'Make room for stillness.',note:'Choose the amount of motion that feels right for you.'},
 consent:{image:'/assets/diary.webp',icon:ShieldCheck,kicker:'04 / YOUR CHOICE',title:'Only what you invite in.',note:'Choose when to reflect. Your diary stays yours.'},
 account:{image:'/assets/letters.webp',icon:BookOpen,kicker:'05 / YOUR NEXT CHAPTER',title:'Take your story with you.',note:'Make an encrypted archive before you leave.'},
};

export default function SettingsIllustration({tab}:{tab:keyof typeof scenes}){
 const scene=scenes[tab],Icon=scene.icon;
 return <aside className={'settings-illustration settings-illustration-'+tab} aria-label={scene.title}>
  <img src={scene.image} alt="" loading="lazy"/>
  <div className="settings-illustration-shade"/>
  <span className="settings-illustration-halo" aria-hidden="true"><Icon size={33} strokeWidth={1}/></span>
  <div className="settings-illustration-copy"><p className="eyebrow">{scene.kicker}</p><h2>{scene.title}</h2><p>{scene.note}</p></div>
 </aside>;
}
