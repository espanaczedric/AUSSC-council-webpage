import { Navigate, useParams } from "react-router-dom";

export default function Register() {
    const { id } = useParams();
    return <Navigate to={id ? `/events/${id}` : "/events"} replace />;
}
