import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/EmptyState';

const NotFoundPage = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <EmptyState
      icon={FileQuestion}
      title="Page not found"
      description="The page you are looking for does not exist or was moved."
      action={(
        <Button asChild>
          <Link to="/dashboard">Go to dashboard</Link>
        </Button>
      )}
    />
  </div>
);

export default NotFoundPage;
