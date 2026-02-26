import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import Sidebar from './components/Sidebar';
import Home from './components/Home';
import CopyBadge from './components/CopyBadge';

function App(){
  const [route, setRoute] = useState('home');
  return (
    <div className="flex">
      <Sidebar active={route} onNav={setRoute} />
      <div className="flex-1 ml-60 bg-[#F9FAFB] min-h-screen">
        {route === 'home' ? <Home /> : <CopyBadge />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
    const props = {width:18,height:18,fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round',className};
